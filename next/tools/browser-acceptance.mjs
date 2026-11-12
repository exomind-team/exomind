/** Optional local acceptance. Requires Playwright and its browser, not a runtime dependency. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../runtime/server.mjs';
const directory = mkdtempSync(join(tmpdir(), 'exomind-browser-'));
let app, browser;
try {
    app = await createApp({ directory, background: false, name: '浏览器验收·合成数据' });
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${app.origin}/#token=${app.token}`);
    await page.locator('#shell').waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).hash, '');
    await page.locator('#capture-text').fill('浏览器端真实写入的合成验收记录');
    await page.locator('#send').click();
    await page.waitForFunction(() => document.querySelector('#capture-text').value === '');
    assert.equal(app.store.count(), 1);
    await page.reload();
    await page.getByText('浏览器端真实写入的合成验收记录', { exact: true }).waitFor();
    await page.locator('#start-block').click();
    await page.locator('#block-name').fill('休息也能记录');
    await page.locator('#block-submit').click();
    await page.locator('.active-card').waitFor();
    await page.getByRole('button', { name: '结束并反馈', exact: true }).click();
    await page.locator('#block-note').fill('休息片刻');
    await page.locator('#block-submit').click();
    await page.waitForFunction(() => !document.querySelector('.active-card'));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5j8AAAAASUVORK5CYII=', 'base64');
    await page.locator('#file-input').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
    await page.locator('#send').click();
    await page.waitForFunction(() => document.querySelector('#file-list').children.length === 0);
    assert.equal(app.blobs.missing().length, 0);
    await page.getByRole('button', { name: '预览图片', exact: true }).click();
    await page.locator('#detail img').waitFor();
    await page.locator('#close-detail').click();
    // A lost response must preserve request identity across retry, not create a second event.
    let dropped = false;
    await page.route('**/v1/capture', async (route) => { if (!dropped) {
        dropped = true;
        await route.fetch();
        await route.abort('failed');
    }
    else
        await route.continue(); });
    const before = app.store.count();
    await page.locator('#capture-text').fill('丢失回执后仍不重复');
    await page.locator('#send').click();
    await page.getByRole('button', { name: '重试确认', exact: true }).waitFor();
    await page.locator('#send').click();
    await page.waitForFunction(() => document.querySelector('#capture-text').value === '');
    assert.equal(app.store.count(), before + 1);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.locator('#send').isVisible());
    await page.locator('[data-view="devices"]').click();
    await page.locator('summary').first().click();
    assert.ok(await page.locator('#join').isVisible());
    assert.deepEqual(errors, []);
    console.log('PASS: 浏览器登录、写入、重载、时间块、图片、丢回执重试、390px 操作完整性。');
}
catch (error) {
    console.error(`FAIL/NOT VERIFIED: ${error.message}`);
    process.exitCode = 1;
}
finally {
    await browser?.close();
    await app?.close();
    rmSync(directory, { recursive: true, force: true });
}
