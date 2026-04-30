// server/api/chat.js — 对话 API
import { Router } from 'express';
import { chat as aiChat } from '../services/ai.js';
import { getSongUrl } from '../services/netease.js';
import { getWeather } from '../services/weather.js';

const router = Router();

// POST /api/chat
router.post('/', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message 是必填字符串' });
    }

    // 获取天气上下文
    const weather = await getWeather();

    // 调用 AI（ai.js 内部已完成歌曲验证）
    const result = await aiChat(message, { weather });

    // 对验证后的歌曲尝试获取播放 URL
    const songs = [];
    if (result.songs && result.songs.length > 0) {
      for (const song of result.songs) {
        const enriched = { ...song, playable: false };
        if (song.id) {
          try {
            const urlInfo = await getSongUrl(song.id);
            enriched.url = urlInfo.url;
            enriched.playable = true;
          } catch {
            // 无版权，保留歌曲信息但不设 URL
          }
        }
        songs.push(enriched);
      }
    }

    res.json({
      reply: result.reply,
      songs,
      mood: result.mood || 'neutral',
    });
  } catch (err) {
    console.error('Chat API 错误:', err);
    res.status(500).json({ error: '服务内部错误' });
  }
});

export default router;
