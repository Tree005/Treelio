// server/api/chat.js — 对话 API
import { Router } from 'express';
import { chat as aiChat } from '../services/ai.js';
import { findSong, getSongUrl, searchSongs } from '../services/netease.js';
import { getWeather } from '../services/weather.js';

const router = Router();

// 从 AI 回复文字中提取歌名（兜底：当 AI 提到歌但没填 songs 时）
function extractSongNames(text) {
  const names = [];
  // 匹配《xxx》格式
  const bookRegex = /《(.+?)》/g;
  let match;
  while ((match = bookRegex.exec(text)) !== null) {
    names.push(match[1]);
  }
  return names;
}

// POST /api/chat
router.post('/', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message 是必填字符串' });
    }

    // 获取天气上下文
    const weather = await getWeather();

    // 调用 AI
    const result = await aiChat(message, { weather });

    // 如果 AI 推荐了歌曲，尝试获取播放信息
    let songs = [];
    if (result.songs && result.songs.length > 0) {
      for (const song of result.songs) {
        // 先保留 AI 给出的信息，playable 标记是否可播放
        const enriched = { ...song, playable: false };
        try {
          if (song.id) {
            try {
              const urlInfo = await getSongUrl(song.id);
              enriched.url = urlInfo.url;
              enriched.playable = true;
            } catch {
              // 无版权/ID 无效，尝试用歌名搜索
              const found = await findSong(song.name, song.artist);
              if (found) {
                try {
                  const urlInfo = await getSongUrl(found.id);
                  enriched.id = found.id;
                  enriched.name = found.name;
                  enriched.artist = found.artist;
                  enriched.coverUrl = found.coverUrl;
                  enriched.url = urlInfo.url;
                  enriched.playable = true;
                } catch {
                  // 搜索到了但无版权，保留搜索到的歌曲信息（无 URL）
                  enriched.id = found.id;
                  enriched.name = found.name;
                  enriched.artist = found.artist;
                  enriched.coverUrl = found.coverUrl;
                }
              }
            }
          } else if (song.name) {
            const found = await findSong(song.name, song.artist);
            if (found) {
              try {
                const urlInfo = await getSongUrl(found.id);
                enriched.id = found.id;
                enriched.name = found.name;
                enriched.artist = found.artist;
                enriched.coverUrl = found.coverUrl;
                enriched.url = urlInfo.url;
                enriched.playable = true;
              } catch {
                enriched.id = found.id;
                enriched.name = found.name;
                enriched.artist = found.artist;
                enriched.coverUrl = found.coverUrl;
              }
            }
          }
        } catch {
          // 单首歌处理失败不影响整体，保留 AI 原始信息
        }
        songs.push(enriched);
      }
    }

    // 兜底：AI 回复提到了歌名但 songs 为空时，提取第一个歌名去搜索
    if (songs.length === 0) {
      const mentioned = extractSongNames(result.reply);
      if (mentioned.length > 0) {
        try {
          const found = await findSong(mentioned[0]);
          if (found) {
            try {
              const urlInfo = await getSongUrl(found.id);
              found = { ...found, ...urlInfo };
            } catch {
              // VIP 或无版权
            }
            songs.push(found);
          }
        } catch {
          // 搜索失败不影响回复
        }
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
