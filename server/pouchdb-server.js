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

// pouchdb-server 路由前缀
const POUCHDB_PREFIX = '';

// pouchdb-server 进程
let pouchdbServerProcess = null;

// 创建 Express 应用
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
 */
function startPouchDBServer() {
  log('启动官方 pouchdb-server...');

  // pouchdb-server 入口
  const pouchdbBin = path.join(__dirname, 'node_modules', 'pouchdb-server', 'lib', 'index.js');

  // 检查是否存在
  if (!fs.existsSync(pouchdbBin)) {
    log(`错误: pouchdb-server 未找到，请先运行: bun install`);
    return false;
  }

  // pouchdb-server 命令行参数
  const args = [
    '-p', String(config.port),
    '-d', DB_DIR,
    '--prefix', POUCHDB_PREFIX,
  ];

  log(`执行: ${pouchdbBin} ${args.join(' ')}`);

  pouchdbServerProcess = spawn(pouchdbBin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
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

  return true;
}

// 启动服务器
const PORT = config.port;
const HOST = config.host;

httpServer.listen(PORT, HOST, () => {
  log(`========================================`);
  log(`PouchDB Sync Server 启动成功`);
  log(`========================================`);
  log(`HTTP 服务器: http://${HOST}:${PORT}`);
  log(`PouchDB 端点: http://${HOST}:${PORT}/:dbname`);
  log(`数据目录: ${DB_DIR}`);
  log(`日志目录: ${LOGS_DIR}`);
  log(`========================================`);

  // 延迟启动 pouchdb-server
  setTimeout(() => {
    if (!startPouchDBServer()) {
      log('警告: pouchdb-server 启动失败，服务器将以只读模式运行');
    }
  }, 500);
});

// 优雅关闭
process.on('SIGINT', () => {
  log('收到关闭信号，正在关闭服务器...');

  if (pouchdbServerProcess) {
    pouchdbServerProcess.kill('SIGTERM');
  }

  httpServer.close(() => {
    log('HTTP 服务器已关闭');
    process.exit(0);
  });
});

// 导出用于测试
export { app, httpServer };
