// server/api/music.js — 音乐搜索/播放 API
import { Router } from 'express';
import { searchSongs, getSongUrl, getLyric } from '../services/netease.js';

const router = Router();

// GET /api/music/search?q=xxx&limit=10
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    if (!q) return res.status(400).json({ error: 'q 参数是必填的' });
    const songs = await searchSongs(q, parseInt(limit));
    res.json({ songs });
  } catch (err) {
    console.error('Music search 错误:', err);
    res.status(500).json({ error: '搜索失败' });
  }
});

// GET /api/music/url?id=xxx
router.get('/url', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id 参数是必填的' });
    const info = await getSongUrl(id);
    res.json(info);
  } catch (err) {
    console.error('Music URL 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/music/lyric?id=xxx
router.get('/lyric', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id 参数是必填的' });
    const lyric = await getLyric(id);
    res.json(lyric);
  } catch (err) {
    console.error('Lyric 错误:', err);
    res.status(500).json({ error: '获取歌词失败' });
  }
});

export default router;
