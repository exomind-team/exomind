/**
 * PouchDB Sync Server
 *
 * 使用官方 pouchdb-server，提供：
 * - 内置用户认证
 * - CouchDB 兼容 API
 * - 实时变更推送
 *
 * 端口: 6984
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import { detectLockedLevelDbFiles } from './startup-guard.js';

// ESM 模块中获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 确保目录存在
const DB_DIR = path.resolve(__dirname, config.dataDir);
const LOGS_DIR = path.resolve(__dirname, config.logsDir);

for (const dir of [DB_DIR, LOGS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 创建日志流
const logStream = fs.createWriteStream(path.join(LOGS_DIR, 'server.log'), { flags: 'a' });

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  logStream.write(logMessage);
  console.log(logMessage.trim());
}

// pouchdb-server 进程
let pouchdbServerProcess = null;

// 创建 Express 应用（用于自定义路由）
const app = express();
const httpServer = createServer(app);

// CORS 配置
app.use(cors({
  origin: config.pouchdbServer?.cors?.origin || '*',
  credentials: config.pouchdbServer?.cors?.credentials || true,
}));
app.use(express.json());

// 健康检查端点
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'PouchDB Sync Server running',
    version: '1.0.0',
    pouchdbServer: pouchdbServerProcess ? 'running' : 'stopped',
    endpoints: {
      health: '/',
      pouchdb: '/:dbname',
      users: '/_users',
      stats: '/stats',
    },
  });
});

// 统计信息端点
app.get('/stats', async (req, res) => {
  try {
    const stats = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pouchdbServer: pouchdbServerProcess ? 'running' : 'stopped',
      databases: [],
    };

    // 获取数据库列表
    if (fs.existsSync(DB_DIR)) {
      const files = fs.readdirSync(DB_DIR);
      stats.databases = files
        .filter(f => f.endsWith('.couch') || f.endsWith('.db'))
        .map(f => f.replace(/\.(couch|db)$/, ''));
    }

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 启动 pouchdb-server 子进程
 * 注意：pouchdb-server 会占用 config.port，所以我们需要监听不同的端口
 * 或者直接使用 pouchdb-server 作为主服务器
 */
function startPouchDBServer() {
  log('启动官方 pouchdb-server...');

  const lockedFiles = detectLockedLevelDbFiles(DB_DIR);
  if (lockedFiles.length > 0) {
    log(`检测到数据目录被其他进程占用，跳过重复启动。锁文件: ${lockedFiles[0]}`);
    log('提示: 这通常表示已有同步服务在运行。若需重启，请先停止旧进程。');
    return { status: 'already-running' };
  }

  // pouchdb-server 入口
  const pouchdbBin = path.join(__dirname, 'node_modules', 'pouchdb-server', 'lib', 'index.js');

  // 检查是否存在
  if (!fs.existsSync(pouchdbBin)) {
    log(`错误: pouchdb-server 未找到，请先运行: bun install`);
    return { status: 'missing-binary' };
  }

  // pouchdb-server 命令行参数
  const args = [
    '-p', String(config.port),
    '-d', DB_DIR,
    '-o', String(config.host),
  ];

  log(`执行: node ${pouchdbBin} ${args.join(' ')}`);

  pouchdbServerProcess = spawn('node', [pouchdbBin, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  pouchdbServerProcess.stdout.on('data', (data) => {
    const message = data.toString().trim();
    if (message) {
      log(`[pouchdb-server] ${message}`);
    }
  });

  pouchdbServerProcess.stderr.on('data', (data) => {
    const message = data.toString().trim();
    if (message) {
      log(`[pouchdb-server ERROR] ${message}`);
    }
  });

  pouchdbServerProcess.on('close', (code) => {
    log(`pouchdb-server 进程退出，代码: ${code}`);
    pouchdbServerProcess = null;
  });

  pouchdbServerProcess.on('error', (err) => {
    log(`pouchdb-server 启动失败: ${err.message}`);
    pouchdbServerProcess = null;
  });

  return { status: 'started' };
}

// 启动 pouchdb-server 作为主服务器
const PORT = config.port;
const HOST = config.host;

log('========================================');
log('PouchDB Sync Server 启动中...');
log('========================================');

const startResult = startPouchDBServer();

if (startResult.status === 'started') {
  log(`pouchdb-server 已在后台启动，地址: ${HOST}:${PORT}`);
  log(`数据目录: ${DB_DIR}`);
  log(`日志目录: ${LOGS_DIR}`);
  log('========================================');
} else if (startResult.status === 'already-running') {
  log('未启动新实例，当前命令已安全退出。');
  process.exit(0);
} else {
  log('启动失败，当前命令退出。');
  process.exit(1);
}

// 优雅关闭
process.on('SIGINT', () => {
  log('收到关闭信号，正在关闭服务器...');

  if (pouchdbServerProcess) {
    pouchdbServerProcess.kill('SIGTERM');
  }

  process.exit(0);
});

// 导出用于测试
export { app };
