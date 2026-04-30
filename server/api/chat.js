// server/api/chat.js — 对话 API
import { Router } from 'express';
import { chat as aiChat } from '../services/ai.js';
import { findSong, getSongUrl, searchSongs } from '../services/netease.js';
import { getWeather } from '../services/weather.js';

const router = Router();

// 从 AI 回复文字中提取所有歌名（支持《》格式和直接英文歌名）
function extractSongNames(text, knownNames = []) {
  const names = new Set(knownNames);

  // 1. 匹配《xxx》中文格式
  const bookRegex = /《(.+?)》/g;
  let match;
  while ((match = bookRegex.exec(text)) !== null) {
    names.add(match[1].trim());
  }

  // 2. 匹配已知歌名在文字中的出现（英文歌名）
  for (const name of knownNames) {
    if (name && text.includes(name)) {
      names.add(name);
    }
  }

  // 3. 简单启发：引号包裹的可能是歌名
  const quoteRegex = /[""](.+?)[""]/g;
  while ((match = quoteRegex.exec(text)) !== null) {
    const candidate = match[1].trim();
    // 过滤太短的或明显不是歌名的
    if (candidate.length >= 2 && !candidate.includes('http')) {
      names.add(candidate);
    }
  }

  return [...names];
}

// 对一首歌做完整的查找+URL获取，返回 enriched 对象
async function enrichSong(song) {
  const enriched = { ...song, playable: false };
  try {
    if (song.id) {
      try {
        const urlInfo = await getSongUrl(song.id);
        enriched.url = urlInfo.url;
        enriched.playable = true;
      } catch {
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
    // 保留 AI 原始信息
  }
  return enriched;
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

    // 收集 AI 已返回的歌曲（去重）
    const songMap = new Map(); // key: name+artist 去重
    const existingNames = [];

    if (result.songs && result.songs.length > 0) {
      for (const song of result.songs) {
        const enriched = await enrichSong(song);
        const key = `${enriched.name}|${enriched.artist}`;
        if (!songMap.has(key)) {
          songMap.set(key, enriched);
          existingNames.push(enriched.name);
        }
      }
    }

    // 从 reply 文字里提取可能被遗漏的歌名，尝试补全
    const mentionedNames = extractSongNames(result.reply, existingNames);
    for (const name of mentionedNames) {
      const key = `${name}|`;
      // 粗略去重：已存在的跳过
      if ([...songMap.keys()].some(k => k.startsWith(name))) continue;
      try {
        const found = await findSong(name);
        if (found) {
          const enriched = await enrichSong(found);
          const k = `${enriched.name}|${enriched.artist}`;
          if (!songMap.has(k)) {
            songMap.set(k, enriched);
          }
        }
      } catch {
        // 搜索失败，跳过
      }
    }

    const songs = [...songMap.values()];

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
