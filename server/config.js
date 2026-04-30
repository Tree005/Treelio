// server/config.js — 环境变量统一管理
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

function loadEnv() {
  const envPath = resolve(rootDir, '.env');
  const env = {};
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    env[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }
  return env;
}

const env = loadEnv();

export default {
  port: parseInt(env.PORT || '8080', 10),
  nodeEnv: env.NODE_ENV || 'development',

  // DeepSeek
  deepseek: {
    apiKey: env.DEEPSEEK_API_KEY,
    model: env.DEEPSEEK_MODEL || 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com',
  },

  // 网易云
  netease: {
    baseUrl: env.NETEASE_API_BASE_URL || 'http://localhost:3000',
    musicU: env.MUSIC_U || '',
  },

  // 和风天气
  qweather: {
    key: env.QWEATHER_API_KEY || '',
    id: env.QWEATHER_API_ID || '',
  },

  // 数据
  dataDir: resolve(rootDir, 'data'),
  dbPath: resolve(rootDir, 'data', 'claudio.db'),
};
