// server/api/weather.js — 天气 API
import { Router } from 'express';
import { getWeather } from '../services/weather.js';

const router = Router();

// GET /api/weather?location=101010100
router.get('/', async (req, res) => {
  try {
    const { location = '101010100' } = req.query;
    const weather = await getWeather(location);
    if (!weather) {
      return res.status(502).json({ error: '天气服务暂时不可用' });
    }
    res.json({ weather, location });
  } catch (err) {
    console.error('Weather API 错误:', err);
    res.status(500).json({ error: '获取天气失败' });
  }
});

export default router;
