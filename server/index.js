// server/index.js — Express 主入口
import express from 'express';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { getDb, closeDb } from './db/index.js';
import chatRouter from './api/chat.js';
import musicRouter from './api/music.js';
import errorHandler from './middleware/errorHandler.js';
import config from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = config.port;

// 中间件
app.use(express.json());

// 静态文件（头像等）
app.use('/assets', express.static(resolve(config.dataDir)));

// API 路由
app.use('/api/chat', chatRouter);
app.use('/api/music', musicRouter);

// 生产模式：serve 前端构建产物
const publicDir = resolve(__dirname, 'public');
if (config.nodeEnv === 'production' && existsSync(publicDir)) {
  app.use(express.static(publicDir));
  // SPA fallback
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(resolve(publicDir, 'index.html'));
    }
  });
}

// 错误处理
app.use(errorHandler);

// 启动
async function start() {
  // 初始化数据库
  await getDb();
  console.log('Database ready');

  app.listen(PORT, () => {
    console.log(`Treelio server running at http://localhost:${PORT}`);
    console.log(`Environment: ${config.nodeEnv}`);
  });
}

// 优雅退出
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  closeDb();
  process.exit(0);
});

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
