// server/api/profile.js — 用户 Profile 统计接口
import express from 'express';
import { getDb } from '../db/index.js';

const router = express.Router();

router.get('/stats', async (req, res) => {
  let db;
  try {
    db = await getDb();
  } catch (e) {
    return res.json({ totalSongs: 0, totalArtists: 0, totalHours: 0 });
  }

  let totalSongs = 0, totalArtists = 0, totalHours = 0;

  try {
    const songRows = db.exec('SELECT COUNT(*) as c FROM play_history');
    if (songRows.length > 0) totalSongs = songRows[0].values[0][0] || 0;
  } catch {}

  try {
    const artistRows = db.exec("SELECT COUNT(DISTINCT artist) as c FROM play_history WHERE artist != ''");
    if (artistRows.length > 0) totalArtists = artistRows[0].values[0][0] || 0;
  } catch {}

  // play_history 没有 duration 列，用播放次数 × 3.5 分钟估算
  try {
    const hoursRows = db.exec('SELECT COUNT(*) as c FROM play_history');
    if (hoursRows.length > 0) {
      totalHours = Math.round((hoursRows[0].values[0][0] * 3.5) / 60);
    }
  } catch {}

  res.json({ totalSongs, totalArtists, totalHours });
});

export default router;
