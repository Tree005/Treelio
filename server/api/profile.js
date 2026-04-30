// server/api/profile.js — 用户 Profile 统计接口
import { getDb } from '../db/index.js';

const router = (req, res) => {
  const db = getDb();

  // 播放历史统计
  let totalSongs = 0;
  let totalArtists = 0;
  let totalHours = 0;

  try {
    // 总播放次数
    const songRows = db.exec('SELECT COUNT(*) as c FROM play_history');
    if (songRows.length > 0) {
      totalSongs = songRows[0].values[0][0];
    }

    // 去重艺人数量（从歌名尝试提取，或从 conversation metadata）
    const artistRows = db.exec('SELECT COUNT(DISTINCT artist) as c FROM play_history WHERE artist != ""');
    if (artistRows.length > 0) {
      totalArtists = artistRows[0].values[0][0];
    }

    // 总播放时长（秒 → 小时）
    const hoursRows = db.exec('SELECT SUM(duration) as total FROM play_history');
    if (hoursRows.length > 0 && hoursRows[0].values[0][0]) {
      totalHours = Math.round(hoursRows[0].values[0][0] / 3600);
    }
  } catch (e) {
    // play_history 表可能不存在或为空
    console.warn('[profile/stats] 统计失败:', e.message);
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    totalSongs,
    totalArtists,
    totalHours,
  }));
};

export default router;
