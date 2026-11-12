#!/usr/bin/env node
import { resolve, join } from 'node:path';
import { mkdirSync, openSync, writeFileSync, readFileSync, existsSync, unlinkSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createApp } from './server.mjs';
import { ChatCompletionProvider } from './summary.mjs';
import { Fault, requireThat, publicError, VERSION } from './contracts.mjs';
const { values } = parseArgs({ options: {
        'data-dir': { type: 'string', default: '.local/rebuild' }, name: { type: 'string', default: '我的设备' }, host: { type: 'string', default: '127.0.0.1' }, port: { type: 'string', default: '19490' },
        advertise: { type: 'string' }, 'allow-trusted-http': { type: 'boolean', default: false }, 'tls-cert': { type: 'string' }, 'tls-key': { type: 'string' }, 'tls-ca': { type: 'string' }, open: { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
    } });
if (values.help) {
    console.log(`外心 ${VERSION}\nnode runtime/cli.mjs [--data-dir <独立目录>] [--name <设备名>] [--port 19490] [--open]\n默认只监听 127.0.0.1。跨设备：--host <绑定地址> --advertise <对端可达URL>\n远程 HTTPS：--tls-cert cert.pem --tls-key key.pem [--tls-ca ca.pem]\n仅受信私网实验：--allow-trusted-http（HTTP 无应用层加密，不能公开暴露）\n模型：EXOMIND_MODEL_URL=完整兼容chat/completions地址；EXOMIND_MODEL_NAME；EXOMIND_MODEL_API_KEY\n没有模型仍可记录与计时，总结等待配置。使用 Ctrl+C 正常停止。`);
    process.exit(0);
}
let app, lockPath, lockHeld = false, stopping = false;
function releaseLock() { if (lockHeld) {
    try {
        unlinkSync(lockPath);
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            console.error('运行锁清理失败，请核对进程状态后处理。');
    }
    lockHeld = false;
} }
function acquireLock(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    lockPath = join(directory, 'runtime.lock');
    if (existsSync(lockPath)) {
        let pid;
        try {
            pid = JSON.parse(readFileSync(lockPath, 'utf8')).pid;
        }
        catch {
            throw new Fault('invalid_lock', '运行锁无法识别，请人工核对，不会自动覆盖');
        }
        let alive = true;
        try {
            process.kill(pid, 0);
        }
        catch (error) {
            if (error.code === 'ESRCH')
                alive = false;
        }
        requireThat(!alive, 'already_running', '此数据目录已有进程或无法确认其已退出；请使用另一个独立目录', 409);
        unlinkSync(lockPath);
    }
    const fd = openSync(lockPath, 'wx', 0o600);
    try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    }
    finally {
        closeSync(fd);
    }
    lockHeld = true;
}
async function stop() { if (stopping)
    return; stopping = true; try {
    await app?.close();
}
finally {
    releaseLock();
} }
try {
    const port = Number(values.port);
    requireThat(Number.isInteger(port) && port >= 0 && port <= 65535, 'invalid_port', '端口无效');
    const directory = resolve(values['data-dir']);
    requireThat(!existsSync(join(directory, 'INCOMPLETE')), 'incomplete_restore', '该目录的恢复未完成，拒绝启动');
    acquireLock(directory);
    let tls;
    requireThat(!!values['tls-cert'] === !!values['tls-key'], 'invalid_tls', 'TLS 证书和密钥必须同时提供');
    if (values['tls-cert'])
        tls = { cert: readFileSync(values['tls-cert']), key: readFileSync(values['tls-key']), ca: values['tls-ca'] ? readFileSync(values['tls-ca'], 'utf8') : null };
    let provider = null;
    if (process.env.EXOMIND_MODEL_URL || process.env.EXOMIND_MODEL_NAME) {
        requireThat(process.env.EXOMIND_MODEL_URL && process.env.EXOMIND_MODEL_NAME, 'invalid_model_config', '模型地址与模型名必须同时配置');
        provider = new ChatCompletionProvider({ url: process.env.EXOMIND_MODEL_URL, model: process.env.EXOMIND_MODEL_NAME, key: process.env.EXOMIND_MODEL_API_KEY, allowTrustedHttp: values['allow-trusted-http'] });
    }
    app = await createApp({ directory, name: values.name, host: values.host, port, advertise: values.advertise, allowTrustedHttp: values['allow-trusted-http'], tls, provider, logger: entry => console.error(JSON.stringify(entry)) });
    const connectionPath = join(directory, 'connection.runtime.json');
    writeFileSync(connectionPath, JSON.stringify({ schema: 1, protocol: app.store.hello().protocol, url: app.origin, advertise: app.advertised, token: app.token, deviceId: app.store.identity.deviceId, role: 'owner', ca: tls?.ca ?? null }, null, 2), { mode: 0o600 });
    console.log(`外心 ${VERSION}\n页面：${app.origin}\n私有连接文件：${connectionPath}\n数据目录：${directory}\n${values['allow-trusted-http'] ? '警告：受信网络 HTTP 实验模式；令牌和记录不受应用层 TLS 保护。' : '默认不开启受信网络 HTTP。'}\n原日用数据库未读取、未迁移、未覆盖。`);
    process.once('SIGINT', () => void stop());
    process.once('SIGTERM', () => void stop());
    if (values.open) {
        const url = `${app.origin}/#token=${encodeURIComponent(app.token)}`;
        // The secret is a local browser fragment, never a query parameter or server log entry.
        const program = process.platform === 'win32' ? 'rundll32' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
        const child = spawn(program, args, { stdio: 'ignore', detached: true });
        child.on('error', () => console.error('无法自动打开浏览器，请手动打开本机页面并使用私有连接文件。'));
        child.unref();
    }
}
catch (error) {
    console.error(JSON.stringify({ error: publicError(error) }));
    await stop();
    process.exitCode = 1;
}
