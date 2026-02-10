// server/pouchdb-server.js
// ExoMind PouchDB Sync Server
// 端口: 6984

import PouchDB from 'pouchdb';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import config from './config.js';

// 确保目录存在
const DB_DIR = path.resolve(config.dataDir);
const LOGS_DIR = path.resolve(config.logsDir);

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// 创建日志流
const logStream = fs.createWriteStream(path.join(LOGS_DIR, 'stdout.log'), { flags: 'a' });

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  logStream.write(logMessage);
  console.log(message);
}

// 创建 Express 应用
const app = express();
app.use(cors());
app.use(express.json());

// HTTP 服务器
const server = http.createServer(app);

// WebSocket 服务器
const io = new Server(server, {
  cors: {
    origin: config.corsOrigin,
    methods: ['GET', 'POST'],
  },
});

// 用户存储（内存中，服务重启后丢失）
// 后续可扩展为持久化到 JSON 文件
const users = new Map(); // username -> { passwordHash, salt }

// 数据库缓存
const dbCache = new Map(); // username -> PouchDB instance

// 生成随机盐
function generateSalt(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 使用 PBKDF2 派生密钥
function pbkdf2(password, salt) {
  const derived = createHash('sha256').update(password + salt).digest('hex');
  return derived;
}

// 获取或创建用户数据库
function getUserDb(username) {
  if (dbCache.has(username)) {
    return dbCache.get(username);
  }

  const dbPath = path.join(DB_DIR, `user-${username}.db`);
  const db = new PouchDB(dbPath);
  dbCache.set(username, db);
  return db;
}

// 初始化用户
function initUser(username, passwordHash, salt) {
  users.set(username, { passwordHash, salt });
  getUserDb(username); // 创建数据库
  log(`用户 ${username} 已初始化`);
}

// 根路径 - 健康检查
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'PouchDB Server running' });
});

// 用户注册
app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码必填' });
  }

  if (users.has(username)) {
    return res.status(409).json({ error: '用户已存在' });
  }

  // 使用 PBKDF2 加盐哈希
  const salt = generateSalt(16);
  const passwordHash = pbkdf2(password, salt);
  initUser(username, passwordHash, salt);

  log(`用户 ${username} 注册成功`);
  res.json({ success: true, message: '用户注册成功' });
});

// 用户登录
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码必填' });
  }

  const user = users.get(username);
  if (!user) {
    return res.status(401).json({ error: '用户不存在' });
  }

  // 验证密码
  const passwordHash = pbkdf2(password, user.salt);
  if (passwordHash !== user.passwordHash) {
    log(`用户 ${username} 登录失败：密码错误`);
    return res.status(403).json({ error: '密码错误' });
  }

  log(`用户 ${username} 登录成功`);
  res.json({ success: true, token: user.passwordHash, username });
});

// 获取用户数据库信息
app.get('/db/:username', async (req, res) => {
  const { username } = req.params;

  const user = users.get(username);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }

  const db = getUserDb(username);
  try {
    const info = await db.info();
    res.json({
      success: true,
      database: `user-${username}.db`,
      docCount: info.doc_count,
      updateSeq: info.update_seq,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取用户所有文档
app.get('/db/:username/_all_docs', async (req, res) => {
  const { username } = req.params;

  const user = users.get(username);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }

  const db = getUserDb(username);
  try {
    const result = await db.allDocs({ include_docs: true });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket 连接处理
io.on('connection', (socket) => {
  log(`WebSocket 客户端连接: ${socket.id}`);

  socket.on('subscribe', ({ username, deviceId }) => {
    socket.join(`user:${username}`);
    log(`客户端 ${deviceId} 订阅用户 ${username}`);
  });

  socket.on('unsubscribe', ({ username }) => {
    socket.leave(`user:${username}`);
    log(`客户端取消订阅用户 ${username}`);
  });

  socket.on('disconnect', () => {
    log(`WebSocket 客户端断开: ${socket.id}`);
  });
});

// 广播变化给订阅者
function broadcastChange(username, change) {
  io.to(`user:${username}`).emit('change', change);
}

// 启动服务器
const PORT = process.env.PORT || config.port;
const HOST = process.env.HOST || config.host;

server.listen(PORT, HOST, () => {
  log(`PouchDB Server 运行在 http://${HOST}:${PORT}`);
  log(`数据目录: ${DB_DIR}`);
  log(`日志目录: ${LOGS_DIR}`);
});

// 优雅关闭
process.on('SIGINT', () => {
  log('收到关闭信号，正在关闭服务器...');
  server.close(() => {
    log('服务器已关闭');
    // 关闭所有数据库连接
    for (const [username, db] of dbCache) {
      db.close();
      log(`数据库 ${username} 已关闭`);
    }
    process.exit(0);
  });
});

export { app, server, io };
