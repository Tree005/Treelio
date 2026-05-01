// server/api/chat.js — 对话 API（重构版）
// 接入 router.js 意图分流 + context.js 上下文组装

import { Router } from 'express';
import { chat as aiChat, quickSearch } from '../services/ai.js';
import { getSongUrl, findSong } from '../services/netease.js';
import { getWeather } from '../services/weather.js';
import { buildContext } from '../context.js';
import { route, INTENT } from '../router.js';

const router = Router();

/**
 * 验证歌曲并获取播放 URL
 * @param {Object} song - 歌曲对象
 * @returns {Promise<Object|null>} 验证后的歌曲（带 URL）
 */
async function verifySong(song) {
  if (!song.name) return null;

  try {
    // 先尝试用已有 ID 获取 URL
    if (song.id) {
      const urlInfo = await getSongUrl(song.id);
      if (urlInfo?.url) {
        return {
          ...song,
          url: urlInfo.url,
          playable: true,
        };
      }
    }

    // 如果没有 ID 或 URL 失效，用歌名搜索
    const match = await findSong(song.name, song.artist);
    if (match) {
      const urlInfo = await getSongUrl(match.id);
      return {
        ...song,
        id: match.id,
        name: match.name,
        artist: match.artist || song.artist,
        album: match.album || song.album,
        coverUrl: match.coverUrl || song.coverUrl,
        url: urlInfo?.url || '',
        playable: !!urlInfo?.url,
      };
    }

    // 找不到，返回不可播放
    return { ...song, playable: false };
  } catch (e) {
    console.warn(`[chat] 验证歌曲失败: ${song.name}`, e.message);
    return { ...song, playable: false };
  }
}

/**
 * 从文本中提取歌名（兜底）
 */
function extractSongNames(text) {
  const names = new Set();

  // 匹配《歌名》格式
  (text.match(/《(.+?)》/g) || []).forEach(m => names.add(m.slice(1, -1)));

  // 匹配引号格式
  (text.match(/["「'\u201c](.+?)["」'\u201d]/g) || []).forEach(m => names.add(m.slice(1, -1)));

  return [...names];
}

// POST /api/chat
router.post('/', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message 是必填字符串' });
    }

    // 意图分流
    const { intent, params } = route(message);
    console.log(`[chat] 意图: ${intent}, 参数:`, params);

    // 获取天气上下文
    const weather = await getWeather();

    // ========== 分流处理 ==========

    // 1. 停止指令
    if (intent === INTENT.STOP) {
      return res.json({
        say: '好的，停止播放。',
        play: [],
        reason: '',
        segue: '',
      });
    }

    // 2. 下一首指令
    if (intent === INTENT.NEXT) {
      return res.json({
        say: '好的，下一首。',
        play: [],
        reason: '',
        segue: 'NEXT',
      });
    }

    // 3. 重播指令
    if (intent === INTENT.REPLAY) {
      return res.json({
        say: '好的，再来一遍。',
        play: [],
        reason: '',
        segue: 'REPLAY',
      });
    }

    // 4. 直接播放指令 — 快速路径
    if (intent === INTENT.PLAY_NOW) {
      const match = await findSong(params.query);
      if (match) {
        const verified = await verifySong({ ...match, name: params.query });
        return res.json({
          say: `播放 ${verified.name}，${verified.artist}`,
          play: [verified],
          reason: '用户直接点播',
          segue: '',
        });
      }
      return res.json({
        say: `没找到 "${params.query}" 这首歌，换一首试试？`,
        play: [],
        reason: '',
        segue: '',
      });
    }

    // 5. 推荐播放指令 — 走 AI，但加场景限定
    if (intent === INTENT.PLAYLIST) {
      const query = params.query || '';
      const scenarioPrompt = query
        ? `用户想听 "${query}" 相关的音乐。`
        : '用户想听点音乐，但没指定具体类型，请根据当前时间、天气和用户的品味来推荐。';

      // 构建带场景限定的上下文
      const ctx = await buildContext(scenarioPrompt, { weather });

      // 临时替换用户消息为场景限定
      const result = await aiChat(ctx.systemPrompt, ctx.history, scenarioPrompt);

      // 验证推荐歌曲
      const verifiedSongs = [];
      for (const song of (result.play || [])) {
        const verified = await verifySong(song);
        if (verified.playable) {
          verifiedSongs.push(verified);
        }
      }

      return res.json({
        say: result.say || `来几首 ${query || '适合现在的'} 音乐。`,
        play: verifiedSongs,
        reason: result.reason || '',
        segue: result.segue || '',
      });
    }

    // 6. 自然语言 — 完整 AI 对话
    const ctx = await buildContext(message, { weather });
    const result = await aiChat(ctx.systemPrompt, ctx.history, message);

    // 兜底：从 say 文本中提取歌名
    if (!result.play || result.play.length === 0) {
      const extractedNames = extractSongNames(result.say);
      if (extractedNames.length > 0) {
        console.log(`[chat] 从文本提取到歌名:`, extractedNames);
        const extra = [];
        for (const name of extractedNames.slice(0, 3)) {
          const match = await findSong(name);
          if (match) {
            const verified = await verifySong(match);
            if (verified.playable) {
              extra.push(verified);
            }
          }
        }
        if (extra.length > 0) {
          result.play = extra;
        }
      }
    }

    // 验证推荐歌曲（只保留有版权的）
    const verifiedSongs = [];
    for (const song of (result.play || [])) {
      const verified = await verifySong(song);
      if (verified.playable) {
        verifiedSongs.push(verified);
      }
    }

    res.json({
      say: result.say,
      play: verifiedSongs,
      reason: result.reason || '',
      segue: result.segue || '',
    });
  } catch (err) {
    console.error('Chat API 错误:', err);
    res.status(500).json({ error: '服务内部错误' });
  }
});

export default router;
