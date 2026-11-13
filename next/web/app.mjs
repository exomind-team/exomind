import { Api, upload, readFile } from './api.mjs';
const $ = id => document.getElementById(id);
const labels = { capture: '随手记', 'block.started': '时间块开始', 'block.ended': '时间块结束', 'block.feedback': '追加反馈', summary: '时间块回顾' };
const states = { paired: '已配对，尚未确认补齐', catching_up: '记录补齐中', attachments_pending: '文字已拉取，附件待补齐', caught_up: '已拉取对端当前快照', paused: '已暂停', revoked: '已撤销', error: '连接或同步异常' };
const jobStates = { pending: '等待处理', waiting_provider: '待配置模型', running: '生成中', succeeded: '已保存', failed: '失败，可重试', cancelled: '已取消' };
let api, identity, files = [], nextBefore = null, query = '', refreshing = false, view = 'buffer', lastTimeline = '', lastCurrent = '', lastPeers = '', lastJobs = '', historyExpanded = false, refreshAgain = false, resetRequested = false, timelineGeneration = 0, blockBusy = false, blockAction = null, selectedUrls = [], detailGeneration = 0;
let captureDraftId = crypto.randomUUID(), captureAttempt = null, captureBusy = false, captureContext = 0;
function el(tag, content, className) { const e = document.createElement(tag); if (content !== undefined)
    e.textContent = content; if (className)
    e.className = className; return e; }
function notice(message, error = false) { $('notice').textContent = message; $('notice').hidden = false; $('notice').classList.toggle('error', error); }
function key(name, deviceId = identity.deviceId) { return `exomind:${deviceId}:${name}`; }
function readLocal(name) {
    try { return JSON.parse(localStorage.getItem(key(name)) ?? 'null'); }
    catch { throw new Error('浏览器草稿读取失败，无法确认先前请求；不会自动生成替代操作。'); }
}
function saveLocal(name, value, { required = false, deviceId = identity.deviceId } = {}) {
    try {
        if (value === null) localStorage.removeItem(key(name, deviceId));
        else localStorage.setItem(key(name, deviceId), JSON.stringify(value));
        return true;
    } catch {
        const message = '浏览器草稿存储不可用。请保留当前内容，恢复存储后重试。';
        notice(message, true);
        if (required) throw new Error(message);
        return false;
    }
}
function date(at) { return new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function formatBytes(size) { return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KiB` : `${(size / 1024 / 1024).toFixed(1)} MiB`; }
function button(label, action, cls = '') { const b = el('button', label, cls); b.type = 'button'; b.addEventListener('click', async () => { b.disabled = true; try {
    await action();
}
catch (error) {
    notice(error.message, true);
}
finally {
    b.disabled = false;
} }); return b; }
function empty(target, title, description) { const box = el('div', undefined, 'empty'); box.append(el('strong', title), el('span', description)); target.append(box); }
function content(op) { const p = op.payload; return op.kind === 'capture' ? p.text : op.kind === 'block.started' ? `开始「${p.name}」${p.note ? `\n${p.note}` : ''}` : op.kind === 'block.ended' ? p.feedback || '时间块已结束。' : op.kind === 'block.feedback' ? p.text : p.narrative; }
function renderRecord(op) {
    const article = el('article', undefined, 'record');
    article.dataset.kind = op.kind;
    const header = el('div', undefined, 'record-head'), kind = el('span', labels[op.kind] ?? op.kind, 'record-kind');
    header.append(kind, el('time', date(op.at)));
    article.append(header, el('div', content(op), 'record-body'));
    const actions = el('div', undefined, 'record-meta');
    for (const file of op.payload.files ?? []) {
        actions.append(button(`${file.name} · ${formatBytes(file.size)}`, () => download(file)));
        if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mime))
            actions.append(button('预览图片', () => showDetail(op), 'text-button'));
    }
    if (op.kind === 'block.ended')
        actions.append(button('追加反馈', () => openBlock('feedback', op.payload.blockId), 'text-button'));
    actions.append(button('查看来源', () => showDetail(op), 'text-button'));
    article.append(actions);
    return article;
}
async function download(file) {
    const blob = await readFile(api, file), url = URL.createObjectURL(blob), a = el('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function showDetail(op) {
    const generation = ++detailGeneration;
    selectedUrls.forEach(URL.revokeObjectURL);
    selectedUrls = [];
    const panel = $('detail-content');
    panel.replaceChildren();
    $('detail').hidden = false;
    panel.append(el('h2', labels[op.kind]), el('p', content(op)));
    if (op.kind === 'summary') {
        panel.append(el('h3', '证据来源'));
        for (const id of op.payload.evidence) {
            panel.append(button(id.slice(0, 12), async () => { const source = await api.get(`/v1/operations/${id}`); await showDetail(source); }, 'text-button'));
        }
        panel.append(el('h3', '覆盖与不确定性'), el('p', (op.payload.uncertainties ?? []).join('\n') || '未额外声明。引用校验不等于语义事实已被验证。'), el('pre', JSON.stringify(op.payload.coverage, null, 2)));
    }
    panel.append(el('h3', '原始记录'), el('pre', JSON.stringify(op, null, 2)));
    if (op.payload.blockId) {
        const block = await api.get(`/v1/blocks/${op.payload.blockId}`);
        if (generation !== detailGeneration)
            return;
        if (block.state === 'end_conflict')
            panel.prepend(el('p', '此时间块有多个离线结束记录，均已保留；本版尚未提供冲突裁决。', 'conflict'));
    }
    for (const file of op.payload.files ?? []) {
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mime))
            continue;
        const image = await readFile(api, file);
        if (generation !== detailGeneration)
            return;
        const url = URL.createObjectURL(image);
        selectedUrls.push(url);
        const img = el('img');
        img.src = url;
        img.alt = file.name;
        panel.prepend(img);
    }
}
function renderCurrent(current) {
    const host = $('active-blocks');
    host.replaceChildren();
    if (current.conflict)
        host.append(el('p', '发现多个离线开始的时间块。它们各自保留，请选择需要结束的一项。', 'conflict'));
    for (const block of current.active) {
        const card = el('div', undefined, 'active-card'), title = el('div', undefined, 'active-title'), timer = el('span', '00:00:00', 'active-time');
        timer.dataset.started = String(block.startedAt);
        title.append(el('span', block.name, 'active-name'), timer);
        card.append(title, button('结束并反馈', () => openBlock('end', block.id)));
        host.append(card);
    }
    $('start-block').disabled = current.active.length > 0;
    updateClocks();
}
function updateClocks() { document.querySelectorAll('[data-started]').forEach(node => { const seconds = Math.max(0, Math.floor((Date.now() - Number(node.dataset.started)) / 1000)); node.textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(v => String(v).padStart(2, '0')).join(':'); }); }
function renderPeers(result) {
    const host = $('peers');
    host.replaceChildren();
    if (!result.items.length)
        empty(host, '目前只保存在这台设备', '同版本设备可通过下方邀请加入；无需配置旧 Mesh 或 PouchDB。');
    for (const peer of result.items) {
        const row = el('article', undefined, 'peer'), header = el('header');
        header.append(el('strong', peer.name), el('span', states[peer.status] ?? peer.status, 'pill'));
        row.append(header, el('p', peer.endpoint, 'code muted'));
        row.append(el('small', peer.last_success ? `最近成功拉取：${date(peer.last_success)} · 游标 ${peer.cursor}` : '尚无成功拉取回执'));
        if (peer.error)
            row.append(el('p', peer.error, 'error'));
        const actions = el('div', undefined, 'peer-actions');
        if (!peer.revoked) {
            actions.append(button('更改地址', async () => { const value = prompt('输入同一设备当前可达的完整 Runtime 地址；身份与配对密钥不改变。', peer.endpoint); if (value) {
                await api.post(`/v1/peers/${peer.id}/endpoint`, { endpoint: value });
                await refresh();
            } }, 'text-button'));
            actions.append(button('立即检查', async () => { const r = await api.post(`/v1/peers/${peer.id}/sync`); if (r.state === 'error')
                throw new Error(r.error.message); await refresh(); }));
            actions.append(button(peer.enabled ? '暂停' : '恢复', async () => { await api.post(`/v1/peers/${peer.id}/${peer.enabled ? 'pause' : 'resume'}`); await refresh(); }));
            actions.append(button('撤销配对', async () => { if (confirm('撤销此设备的本机访问权限？不会远程删除它已持有的记录。')) {
                await api.post(`/v1/peers/${peer.id}/revoke`);
                await refresh();
            } }, 'text-button'));
        }
        row.append(actions);
        host.append(row);
    }
    $('space-state').textContent = result.items.filter(p => !p.revoked).length ? `${result.items.filter(p => !p.revoked).length} 台已配对 · 待收附件 ${result.missingAttachments}` : '仅此设备';
}
function renderJobs(data) {
    $('provider-status').textContent = data.providerConfigured ? '已配置模型。自动总结只由产生结束操作的本机领取；远端记录不会触发重复生成。' : '模型尚未配置。结束记录与反馈仍可靠保存，总结任务会等待。使用启动环境变量接入现有 Magpie 或模型服务。';
    const host = $('jobs');
    host.replaceChildren();
    if (!data.items.length)
        empty(host, '还没有时间块回顾', '结束一个时间块后，这里会显示真实的处理状态。');
    for (const job of data.items) {
        const row = el('article', undefined, 'job'), header = el('header');
        header.append(el('strong', date(job.created_at)), el('span', jobStates[job.state], 'job-status'));
        row.append(header, el('small', `时间块 ${job.block_id.slice(0, 12)} · 尝试 ${job.attempts} 次`));
        if (job.error)
            row.append(el('p', job.error, 'error'));
        if (['pending', 'running', 'waiting_provider'].includes(job.state))
            row.append(button('取消生成', async () => { await api.post(`/v1/jobs/${job.id}/cancel`); await refresh(); }, 'text-button'));
        if (['failed', 'cancelled', 'waiting_provider'].includes(job.state))
            row.append(button('重试', async () => { await api.post(`/v1/jobs/${job.id}/retry`); await refresh(); }, 'text-button'));
        if (job.result_id)
            row.append(button('查看回顾', async () => showDetail(await api.get(`/v1/operations/${job.result_id}`)), 'text-button'));
        host.append(row);
    }
}
async function refresh({ reset = false } = {}) {
    if (!api) return;
    resetRequested ||= reset;
    if (refreshing) { refreshAgain = true; return; }
    refreshing = true;
    const generation = timelineGeneration;
    const currentQuery = query;
    const shouldReset = resetRequested;
    resetRequested = false;
    try {
        const [timeline, current, peers, jobs] = await Promise.all([api.get(currentQuery ? `/v1/search?q=${encodeURIComponent(currentQuery)}` : '/v1/timeline'), api.get('/v1/current'), api.get('/v1/peers'), api.get('/v1/jobs')]);
        if (generation !== timelineGeneration) return;
        $('connection').textContent = 'Runtime 已连接';
        // Background refresh does not repaint unchanged content or reset an expanded history.
        const stamp = JSON.stringify(timeline.items);
        if (shouldReset) historyExpanded = false;
        $('return-latest').hidden = !historyExpanded;
        if (shouldReset || (!historyExpanded && stamp !== lastTimeline)) {
            lastTimeline = stamp;
            const host = $('timeline');
            host.replaceChildren();
            timeline.items.forEach(op => host.append(renderRecord(op)));
            if (!timeline.items.length)
                empty(host, query ? '没有匹配记录' : '把此刻留在这里', query ? '可以换一个关键词。' : '文字、截图与文件，先记录，再决定如何整理。');
            nextBefore = timeline.nextBefore;
            $('load-more').hidden = !nextBefore;
        }
        if (JSON.stringify(current) !== lastCurrent) {
            lastCurrent = JSON.stringify(current);
            renderCurrent(current);
        }
        if (JSON.stringify(peers) !== lastPeers) {
            lastPeers = JSON.stringify(peers);
            renderPeers(peers);
        }
        if (JSON.stringify(jobs) !== lastJobs) {
            lastJobs = JSON.stringify(jobs);
            renderJobs(jobs);
        }
    }
    catch (error) {
        if (generation !== timelineGeneration) return;
        $('connection').textContent = '连接未确认';
        notice(`读取失败，保留已显示内容：${error.message}`, true);
    }
    finally {
        refreshing = false;
        if (refreshAgain) { refreshAgain = false; void refresh(); }
    }
}
function touchCaptureDraft() {
    captureDraftId = crypto.randomUUID();
    saveLocal('draft', { id: captureDraftId, text: $('capture-text').value });
}
function restoreCaptureDraft() {
    const stored = readLocal('pending');
    // Old clients stored only the request. Its draft ownership is unknown, so
    // confirming that legacy request must never clear a recovered current draft.
    const envelope = stored === null ? null : stored && typeof stored === 'object' && Object.hasOwn(stored, 'request') ? stored : { request: stored, draftId: null };
    const draft = readLocal('draft');
    if (draft !== null && typeof draft !== 'string' && !(typeof draft?.id === 'string' && typeof draft?.text === 'string'))
        throw new Error('浏览器草稿格式无效，原存储已保留，请勿用新操作替代未确认请求。');
    if (envelope && !(typeof envelope.request?.id === 'string' && typeof envelope.request.text === 'string' && Array.isArray(envelope.request.files)))
        throw new Error('待确认请求格式无效，原存储已保留。');
    captureDraftId = draft && typeof draft === 'object' ? draft.id : draft === null && typeof envelope?.draftId === 'string' ? envelope.draftId : crypto.randomUUID();
    $('capture-text').value = typeof draft === 'string' ? draft : draft?.text ?? envelope?.request.text ?? '';
    captureAttempt = envelope ? { draftId: typeof envelope.draftId === 'string' ? envelope.draftId : null, request: envelope.request, durable: true } : null;
    captureBusy = false;
    $('capture-text').readOnly = false;
    $('file-input').disabled = false;
    $('send').disabled = false;
    $('send').textContent = envelope ? '重试上一条' : '记下';
    if (envelope) $('save-state').textContent = '上次提交尚未确认；重试沿用原 ID，当前输入属于下一稿。';
}
function renderFiles() { const host = $('file-list'); host.replaceChildren(); files.forEach((file, i) => { const chip = el('span', undefined, 'file-chip'); chip.append(el('span', `${file.name} · ${formatBytes(file.size)}`), button('×', () => { files.splice(i, 1); touchCaptureDraft(); renderFiles(); })); chip.lastChild.setAttribute('aria-label', `移除 ${file.name}`); host.append(chip); }); }
function addFiles(values) { const all = [...files, ...values]; if (all.length > 16)
    return notice('首版每条最多 16 个附件。', true); if (all.some(f => f.size > 64 * 1024 * 1024))
    return notice('首版单附件上限 64 MiB。', true); files = all; touchCaptureDraft(); renderFiles(); }
async function send() {
    if (captureBusy) return;
    const context = captureContext;
    const runtimeApi = api;
    const deviceId = identity.deviceId;
    captureBusy = true;
    $('send').disabled = true;
    let attempt = captureAttempt;
    const current = () => context === captureContext && captureAttempt === attempt;
    try {
        if (!attempt) {
            const value = $('capture-text').value;
            if (!value.trim() && !files.length) return;
            const active = JSON.parse(lastCurrent || '{"active":[]}').active;
            attempt = { id: crypto.randomUUID(), draftId: captureDraftId, text: value, sourceFiles: [...files], blockId: active.length === 1 ? active[0].id : null, request: null };
            captureAttempt = attempt;
        }
        if (!attempt.request) {
            const attachments = [];
            for (const file of attempt.sourceFiles) {
                if (!current()) return;
                $('save-state').textContent = `校验并上传 ${file.name}`;
                attachments.push(await upload(runtimeApi, file, (sent, total) => { if (current()) $('save-state').textContent = `${file.name} · ${formatBytes(sent)} / ${formatBytes(total)}`; }));
            }
            if (!current()) return;
            attempt.request = { id: attempt.id, text: attempt.text, files: attachments, blockId: attempt.blockId };
        }
        const pending = attempt.request;
        saveLocal('pending', { draftId: attempt.draftId, request: pending }, { required: true, deviceId });
        attempt.durable = true;
        const receipt = await runtimeApi.post('/v1/capture', pending);
        if (receipt.id !== pending.id || receipt.durability !== 'local_committed')
            throw new Error('回执身份不匹配，记录仍待确认');
        if (!current()) return;
        // Keep the retry identity durable until all receipt-owned draft cleanup
        // succeeds. A failure between the two keys must not mint a new command.
        if (captureDraftId === attempt.draftId) {
            saveLocal('draft', null, { required: true });
        }
        saveLocal('pending', null, { required: true, deviceId });
        if (captureDraftId === attempt.draftId) {
            files = [];
            renderFiles();
            $('capture-text').value = '';
            captureDraftId = crypto.randomUUID();
        }
        captureAttempt = null;
        $('send').textContent = '记下';
        $('save-state').textContent = '已保存到本机。对端是否已收到，请在对端核对。';
        $('notice').hidden = true;
        await refresh();
    }
    catch (error) {
        if (!current()) return;
        $('send').textContent = '重试上一条';
        $('save-state').textContent = attempt.durable
            ? '原提交已冻结，重试沿用原 ID，不会采用下一稿；可重新打开页面继续确认。'
            : '原提交尚未完成上传/暂存，请保持页面打开并重试；重试不会采用下一稿。';
        notice(error.message, true);
    }
    finally {
        if (context === captureContext) {
            captureBusy = false;
            $('send').disabled = false;
        }
    }
}
function openBlock(action, blockId) {
    if (blockBusy) return;
    const storageKey = `block-${action}-${blockId ?? 'new'}`;
    blockAction = { action, blockId, storageKey };
    const pending = readLocal(storageKey);
    $('block-dialog-title').textContent = action === 'start' ? '开始时间块' : action === 'end' ? '结束并反馈' : '追加反馈';
    $('block-name').hidden = action !== 'start';
    $('block-name-label').hidden = action !== 'start';
    $('block-name').required = action === 'start';
    $('block-note-label').textContent = action === 'start' ? '备注（可留空）' : '此刻的反馈（不强求成果）';
    $('block-name').value = pending?.name ?? '';
    $('block-note').value = pending?.note ?? pending?.feedback ?? pending?.text ?? '';
    $('block-submit').textContent = action === 'start' ? '开始' : action === 'end' ? '结束并保存' : '保存反馈';
    $('block-name').readOnly = !!pending;
    $('block-note').readOnly = !!pending;
    $('block-error').textContent = pending ? '上次提交未确认，当前只重试原操作，不会提交新内容。' : '';
    $('block-dialog').showModal();
}
$('block-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (blockBusy) return;
    blockBusy = true;
    $('block-submit').disabled = true;
    $('cancel-block').disabled = true;
    $('block-name').readOnly = true;
    $('block-note').readOnly = true;
    const { action, blockId, storageKey } = blockAction;
    try {
        let input = readLocal(storageKey);
        if (!input) {
            input = { id: crypto.randomUUID(), ...(action === 'start' ? { name: $('block-name').value, note: $('block-note').value } : action === 'end' ? { blockId, feedback: $('block-note').value } : { blockId, text: $('block-note').value }) };
            saveLocal(storageKey, input, { required: true });
        }
        const receipt = await api.post(`/v1/blocks/${action}`, input);
        if (receipt.id !== input.id)
            throw new Error('回执 ID 不匹配');
        saveLocal(storageKey, null, { required: true });
        $('block-dialog').close();
        await refresh();
    }
    catch (error) {
        $('block-error').textContent = `${error.message}。未确认的重试沿用原操作。`;
        if (error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
            saveLocal(storageKey, null);
            $('block-name').readOnly = false;
            $('block-note').readOnly = false;
        }
    }
    finally {
        blockBusy = false;
        $('block-submit').disabled = false;
        $('cancel-block').disabled = false;
    }
});
$('block-dialog').addEventListener('cancel', e => { if (blockBusy) e.preventDefault(); });
$('cancel-block').onclick = () => $('block-dialog').close();
$('start-block').onclick = () => openBlock('start');
$('send').onclick = send;
$('capture-text').addEventListener('input', touchCaptureDraft);
globalThis.addEventListener('beforeunload', event => {
    const unpersistedAttempt = captureAttempt && !captureAttempt.durable;
    const unpersistedFiles = files.length && !(captureAttempt?.durable && captureAttempt.draftId === captureDraftId);
    if (unpersistedAttempt || unpersistedFiles) {
        // File objects are not durable browser storage. The prototype must warn
        // about leaving, rather than claim the next draft's bytes can be restored.
        event.preventDefault();
        event.returnValue = '';
    }
});
$('capture-text').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    if (!$('send').disabled)
        void send();
} });
$('capture-text').addEventListener('paste', e => { const pasted = [...(e.clipboardData?.files ?? [])]; if (pasted.length) {
    e.preventDefault();
    addFiles(pasted);
} });
$('file-input').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
$('view-buffer').addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files'))
    e.preventDefault(); });
$('view-buffer').addEventListener('drop', e => { if (e.dataTransfer.files.length) {
    e.preventDefault();
    addFiles([...e.dataTransfer.files]);
} });
$('load-more').onclick = async () => {
    if ($('load-more').disabled || nextBefore === null) return;
    $('load-more').disabled = true;
    const generation = timelineGeneration;
    const cursor = nextBefore;
    historyExpanded = true;
    $('return-latest').hidden = false;
    try {
        const path = query ? `/v1/search?q=${encodeURIComponent(query)}&before=${cursor}` : `/v1/timeline?before=${cursor}`;
        const result = await api.get(path);
        if (generation !== timelineGeneration) return;
        result.items.forEach(op => $('timeline').append(renderRecord(op)));
        nextBefore = result.nextBefore;
        $('load-more').hidden = !nextBefore;
    } catch (error) { if (generation === timelineGeneration) notice(error.message, true); }
    finally { $('load-more').disabled = false; }
};
$('return-latest').onclick = () => { timelineGeneration++; void refresh({ reset: true }); };
let searchTimer;
$('search').oninput = () => {
    clearTimeout(searchTimer);
    timelineGeneration++; // Invalidate stale search/history responses before the debounce expires.
    query = $('search').value;
    resetRequested = true;
    searchTimer = setTimeout(() => void refresh({ reset: true }), 250);
};
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { view = b.dataset.view; document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== `view-${view}`); document.querySelectorAll('[data-view]').forEach(n => n.classList.toggle('active', n === b)); $('page-title').textContent = { buffer: '上下文缓冲区', devices: '设备连接', summaries: '时间块回顾', access: '外部接入' }[view]; });
$('close-detail').onclick = () => { detailGeneration++; $('detail').hidden = true; selectedUrls.forEach(URL.revokeObjectURL); selectedUrls = []; };
async function withNotice(action) { try {
    await action();
}
catch (error) {
    notice(error.message, true);
} }
$('make-invite').onclick = () => withNotice(async () => { $('invite-output').value = JSON.stringify(await api.post('/v1/pair/invitation', { endpoint: $('advertise').value }), null, 2); });
$('copy-invite').onclick = () => withNotice(async () => { await navigator.clipboard.writeText($('invite-output').value); notice('邀请已复制；只通过可信渠道交给另一台设备。'); });
$('join').onclick = () => withNotice(async () => { $('join').disabled = true; try {
    if (captureAttempt) throw new Error('请先确认上一条记录，再加入另一档案。');
    await api.post('/v1/pair/join', { invitation: JSON.parse($('invite-input').value), endpoint: $('return-endpoint').value });
    identity = await api.get('/v1/hello');
    notice('已建立配对，数据是否补齐请以设备回执为准。');
    await refresh();
}
finally {
    $('join').disabled = false;
} });
$('diagnostics').onclick = () => withNotice(async () => { $('diagnostics-output').textContent = JSON.stringify(await api.get('/v1/diagnostics'), null, 2); });
$('access-form').onsubmit = e => { e.preventDefault(); void withNotice(async () => { const result = await api.post('/v1/access-tokens', { name: $('access-name').value, role: $('access-role').value }); $('access-result').textContent = JSON.stringify(result, null, 2); }); };
async function connect(token) {
    captureContext++;
    api = new Api(token);
    identity = await api.get('/v1/hello');
    sessionStorage.setItem('exomind-token', token);
    $('login').hidden = true;
    $('shell').hidden = false;
    $('version').textContent = identity.version;
    $('device-name').textContent = identity.name;
    $('advertise').value = location.origin;
    $('return-endpoint').value = location.origin;
    restoreCaptureDraft();
    await refresh({ reset: true });
    $('capture-text').focus();
}
$('login-form').onsubmit = async (e) => { e.preventDefault(); try {
    await connect($('token').value.trim());
}
catch (error) {
    $('login-error').textContent = error.message;
    api = null;
} };
$('logout').onclick = () => { sessionStorage.removeItem('exomind-token'); api = null; location.reload(); };
const fragment = new URLSearchParams(location.hash.slice(1));
const token = fragment.get('token') || sessionStorage.getItem('exomind-token');
if (location.hash)
    history.replaceState(null, '', location.pathname);
if (token)
    connect(token).catch(error => { $('login-error').textContent = error.message; api = null; });
setInterval(() => { if (!document.hidden)
    void refresh(); }, 2000);
setInterval(updateClocks, 1000);
