// server/api/player.js — 播放器相关 API
import { Router } from 'express';
import { getDb, saveDb } from '../db/index.js';

const router = Router();

// POST /api/player/history — 记录播放历史
router.post('/history', async (req, res) => {
  try {
    const { songId, songName, artist } = req.body;
    if (!songId) {
      return res.status(400).json({ error: 'songId 是必填的' });
    }

    const db = await getDb();
    db.run(
      'INSERT INTO play_history (song_id, song_name, artist) VALUES (?, ?, ?)',
      [songId, songName || '', artist || '']
    );
    saveDb();

    res.json({ ok: true });
  } catch (err) {
    console.error('Play history 写入错误:', err);
    res.status(500).json({ error: '记录播放历史失败' });
  }
});

// GET /api/player/history — 获取播放历史（最近50条）
router.get('/history', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec(
      'SELECT * FROM play_history ORDER BY played_at DESC LIMIT 50'
    );
    const history = result.length > 0
      ? result[0].values.map(row => ({
          id: row[0],
          songId: row[1],
          songName: row[2],
          artist: row[3],
          playedAt: row[4],
        }))
      : [];
    res.json({ history });
  } catch (err) {
    console.error('Play history 查询错误:', err);
    res.status(500).json({ error: '获取播放历史失败' });
  }
});

export default router;
