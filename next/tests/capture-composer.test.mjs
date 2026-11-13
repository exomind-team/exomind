import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
class Element {
    value = ''; children = []; listeners = {}; classList = { toggle() {} };
    disabled = false; readOnly = false; hidden = false; textContent = '';
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    get lastChild() { return this.children.at(-1); }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    setAttribute() {}
    focus() {}
}
function client({ upload = async (_api, file) => ({ hash: file.name, size: file.size, name: file.name, mime: 'text/plain' }), post, storage = new Map() } = {}) {
    const nodes = new Map();
    const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
    const posts = [], windowListeners = {};
    const api = { post: async (path, body) => {
        posts.push(JSON.parse(JSON.stringify(body)));
        return post ? post(path, body) : { id: body.id, durability: 'local_committed' };
    } };
    const context = vm.createContext({
        Api: class {}, upload, readFile() {}, crypto: { randomUUID },
        document: { getElementById: node, querySelectorAll: () => [], createElement: () => new Element() },
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        sessionStorage: { getItem: () => null }, location: { hash: '', pathname: '/' },
        URLSearchParams, setInterval() {}, console, apiFixture: api,
        addEventListener: (name, handler) => { windowListeners[name] = handler; },
    });
    const source = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8').replace(/^import .*?;\r?\n/, '');
    vm.runInContext(source, context);
    vm.runInContext("api = apiFixture; identity = { deviceId: 'synthetic-device', spaceId: 'synthetic-space' }; refresh = async () => {}; lastCurrent = JSON.stringify({ active: [{id:'initial-block'}] });", context);
    // Bypass only transport/refresh; tests drive the actual page handlers and restoration.
    return {
        node, storage, posts, run: expression => vm.runInContext(expression, context),
        text(value) { node('capture-text').value = value; node('capture-text').listeners.input(); },
        files(values) { context.fileFixture = values; vm.runInContext('addFiles(fileFixture)', context); },
        remove(index) { return node('file-list').children[index].lastChild.listeners.click(); },
        send() { return vm.runInContext('send()', context); },
        restore() { vm.runInContext('restoreCaptureDraft()', context); },
        leaving() { let prevented = false; windowListeners.beforeunload({ preventDefault() { prevented = true; } }); return prevented; },
    };
}
const file = name => ({ name, size: 1, type: 'text/plain' });

test('upload edits cannot change the fixed A/B submission or erase the next draft', async () => {
    const gate = deferred(), entered = deferred(), uploaded = [];
    const app = client({ upload: async (_api, value) => {
        uploaded.push(value.name);
        if (value.name === 'A') { entered.resolve(); await gate.promise; }
        return { name: value.name, hash: value.name, size: 1, mime: 'text/plain' };
    } });
    app.text('original'); app.files([file('A'), file('B')]);
    const sending = app.send(); await entered.promise;
    await app.remove(0); app.files([file('C')]); app.text('next draft');
    app.run("lastCurrent = JSON.stringify({active:[{id:'later-block'}]})");
    gate.resolve(); await sending;
    assert.deepEqual(uploaded, ['A', 'B']);
    assert.equal(app.posts[0].blockId, 'initial-block');
    assert.equal(app.posts[0].text, 'original');
    assert.equal(app.node('capture-text').value, 'next draft');
    assert.equal(app.node('file-list').children.length, 2);
});

test('an uncertain receipt retries the same payload and keeps an identical newly authored draft', async () => {
    const gate = deferred(), entered = deferred();
    let attempt = 0;
    const app = client({ post: async (_path, body) => {
        if (++attempt === 1) { entered.resolve(); await gate.promise; throw new Error('response lost'); }
        return { id: body.id, durability: 'local_committed' };
    } });
    app.text('same text');
    const sending = app.send(); await entered.promise;
    app.text('same text'); gate.resolve(); await sending;
    await app.send();
    assert.deepEqual(app.posts[1], app.posts[0]);
    assert.equal(app.node('capture-text').value, 'same text');
});

test('upload failure retries its frozen attachments instead of adopting the next draft', async () => {
    const uploaded = []; let fail = true;
    const app = client({ upload: async (_api, value) => {
        uploaded.push(value.name);
        if (value.name === 'B' && fail) { fail = false; throw new Error('upload interrupted'); }
        return { name: value.name, hash: value.name, size: 1, mime: 'text/plain' };
    } });
    app.text('original'); app.files([file('A'), file('B')]); await app.send();
    await app.remove(0); app.files([file('C')]); app.text('new'); await app.send();
    assert.deepEqual(uploaded, ['A', 'B', 'A', 'B']);
    assert.equal(app.posts[0].text, 'original');
    assert.equal(app.node('capture-text').value, 'new');
});

test('reload replays the persisted request without clearing an identical next draft', async () => {
    const storage = new Map();
    const first = client({ storage, post: async () => { throw new Error('response lost'); } });
    first.text('same'); await first.send(); first.text('same');
    const reloaded = client({ storage }); reloaded.restore();
    assert.equal(reloaded.node('capture-text').value, 'same');
    await reloaded.send();
    assert.deepEqual(reloaded.posts[0], first.posts[0]);
    assert.equal(reloaded.node('capture-text').value, 'same');
    assert.equal(JSON.parse(storage.get('exomind:synthetic-device:draft')).text, 'same');
});

test('reload can clear its matching original draft after a confirmed receipt', async () => {
    const storage = new Map();
    const first = client({ storage, post: async () => { throw new Error('response lost'); } });
    first.text('original'); await first.send();
    const reloaded = client({ storage }); reloaded.restore(); await reloaded.send();
    assert.deepEqual(reloaded.posts[0], first.posts[0]);
    assert.equal(reloaded.node('capture-text').value, '');
    assert.equal(storage.has('exomind:synthetic-device:pending'), false);
});

test('legacy pending bodies cannot claim ownership of the recovered current draft', async () => {
    const pending = { id: randomUUID(), text: 'previous', files: [], blockId: null };
    const storage = new Map([
        ['exomind:synthetic-device:pending', JSON.stringify(pending)],
        ['exomind:synthetic-device:draft', JSON.stringify('current')],
    ]);
    const app = client({ storage }); app.restore(); await app.send();
    assert.deepEqual(app.posts[0], pending);
    assert.equal(app.node('capture-text').value, 'current');
});

test('mismatched receipts retain the exact pending request for retry', async () => {
    let first = true;
    const app = client({ post: async (_path, body) => {
        if (first) { first = false; return { id: randomUUID(), durability: 'local_committed' }; }
        return { id: body.id, durability: 'local_committed' };
    } });
    app.text('original'); await app.send();
    assert.equal(app.node('capture-text').value, 'original');
    await app.send();
    assert.deepEqual(app.posts[1], app.posts[0]);
    assert.equal(app.node('capture-text').value, '');
});

test('overlapping button/keyboard sends share one in-flight submission', async () => {
    const gate = deferred(), entered = deferred();
    const app = client({ post: async (_path, body) => {
        entered.resolve(); await gate.promise;
        return { id: body.id, durability: 'local_committed' };
    } });
    app.text('once'); const first = app.send(); await entered.promise;
    await app.send(); gate.resolve(); await first;
    assert.equal(app.posts.length, 1);
});

test('failed pending cleanup retains retry identity and does not erase the draft', async () => {
    class InterruptedStorage extends Map {
        fail = true;
        delete(key) {
            if (this.fail && key.endsWith(':pending')) { this.fail = false; throw new Error('storage unavailable'); }
            return super.delete(key);
        }
    }
    const app = client({ storage: new InterruptedStorage() });
    app.text('original'); await app.send();
    assert.equal(app.node('capture-text').value, 'original');
    await app.send();
    assert.deepEqual(app.posts[1], app.posts[0]);
    assert.equal(app.node('capture-text').value, '');
});

test('a draft cleanup failure cannot lose the durable retry ID across reload', async () => {
    class InterruptedStorage extends Map {
        fail = true;
        delete(key) {
            if (this.fail && key.endsWith(':draft')) { this.fail = false; throw new Error('draft cleanup interrupted'); }
            return super.delete(key);
        }
    }
    const storage = new InterruptedStorage();
    const first = client({ storage }); first.text('original'); await first.send();
    assert.ok(storage.has('exomind:synthetic-device:pending'));
    const reloaded = client({ storage }); reloaded.restore(); await reloaded.send();
    assert.deepEqual(reloaded.posts[0], first.posts[0]);
    assert.equal(reloaded.node('capture-text').value, '');
});

test('corrupt recovered drafts are retained and never replaced with a new request', () => {
    const storage = new Map([['exomind:synthetic-device:draft', JSON.stringify({ wrong: 'shape' })]]);
    const app = client({ storage });
    assert.throws(() => app.restore(), /草稿格式无效/);
    assert.equal(storage.get('exomind:synthetic-device:draft'), '{"wrong":"shape"}');
    assert.equal(app.posts.length, 0);
});

test('a replaced client context cannot apply an older receipt to its restored composer', async () => {
    const gate = deferred(), entered = deferred();
    const app = client({ post: async (_path, body) => {
        entered.resolve(); await gate.promise;
        return { id: body.id, durability: 'local_committed' };
    } });
    app.text('first'); const sending = app.send(); await entered.promise;
    app.text('new context draft');
    app.run('captureContext++'); app.restore();
    gate.resolve(); await sending;
    assert.equal(app.node('capture-text').value, 'new context draft');
    assert.ok(app.storage.has('exomind:synthetic-device:pending'));
});

test('leaving warns for unuploaded files, but not for a durably pending original group', async () => {
    const gate = deferred(), entered = deferred();
    const app = client({ post: async (_path, body) => {
        entered.resolve(); await gate.promise;
        return { id: body.id, durability: 'local_committed' };
    } });
    app.files([file('A')]); assert.equal(app.leaving(), true);
    const sending = app.send(); await entered.promise;
    assert.equal(app.leaving(), false);
    app.files([file('next')]); assert.equal(app.leaving(), true);
    gate.resolve(); await sending;
    assert.equal(app.leaving(), true);
});
