// server/config.js
// PouchDB Server 配置文件

export default {
  // 服务端口
  port: 6986,

  // 数据库存储目录
  dataDir: './data',

  // 日志目录
  logsDir: './logs',

  // CORS 来源（开发环境可放宽）
  corsOrigin: '*',

  // 轮询间隔（毫秒），实时模式不使用
  pollingInterval: 300000,

  // 服务器主机（0.0.0.0 允许局域网访问）
  host: '127.0.0.1',

  // pouchdb-server 配置
  pouchdbServer: {
    // 基础认证配置
    auth: {
      // 禁用注册（仅允许预设用户或由服务器管理）
      register: false,
    },
    // CORS 配置
    cors: {
      origin: '*',  // 开发环境允许所有，生产环境应限制
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'],
      credentials: true,
    },
  },
};
