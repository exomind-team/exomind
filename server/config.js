// server/config.js
// PouchDB Server 配置文件

export default {
  // 服务端口
  port: 6984,

  // 数据库存储目录
  dataDir: './data',

  // 日志目录
  logsDir: './logs',

  // CORS 来源（开发环境可放宽）
  corsOrigin: '*',

  // 轮询间隔（毫秒），实时模式不使用
  pollingInterval: 300000,

  // 服务器主机（0.0.0.0 允许局域网访问）
  host: '0.0.0.0',
};
