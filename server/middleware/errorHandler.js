// server/middleware/errorHandler.js — 统一错误处理
import config from '../config.js';

export default function errorHandler(err, req, res, _next) {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: config.nodeEnv === 'production' ? '服务内部错误' : err.message,
  });
}
