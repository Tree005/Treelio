// server/api/chat.js — 对话 API（重构版）
// 接入 router.js 意图分流 + context.js 上下文组装

import { Router } from 'express';
import { chat as aiChat, quickSearch } from '../services/ai.js';
import { getSongUrl, findSong } from '../services/netease.js';
import { findLocal } from '../services/song-index.js';
import { getWeather } from '../services/weather.js';
import { buildContext } from '../context.js';
import { route, INTENT } from '../router.js';

const router = Router();

/**
 * 判定是否为"僵尸歌曲"（预览片段、试听版、异常短）
 * @param {Object} song - 含 duration 的歌曲对象
 * @returns {string|null} 原因，null 表示正常
 */
function isZombieSong(song) {
  const d = song.duration || 0;
  if (d > 0 && d < 60000) {
    return `时长仅 ${Math.round(d / 1000)}秒（可能是预览片段）`;
  }
  // URL 明确是试听链接
  if (song.url && (
    /preview|trial|sample|audition/i.test(song.url) ||
    /\.mp3.*[?&]level=standard/i.test(song.url)
  )) {
    return 'URL 为试听版本';
  }
  return null;
}

/**
 * 验证歌曲并获取播放 URL
 * 优先级：已有 ID → 本地歌单索引 → 网易云搜索
 */
async function verifySong(song) {
  if (!song.name) return null;

  try {
    // 1. 先尝试用已有 ID 获取 URL
    if (song.id) {
      const urlInfo = await getSongUrl(song.id);
      if (urlInfo?.url) {
        const candidate = { ...song, url: urlInfo.url };
        const zombie = isZombieSong(candidate);
        if (zombie) {
          console.log(`[chat-zombie] ${song.name} (${song.artist}): ${zombie}`);
          return { ...candidate, playable: false, _zombie: zombie };
        }
        return { ...candidate, playable: true };
      }
    }

    // 2. 从本地歌单索引查找（810首用户真实歌单，ID 准确）
    const local = findLocal(song.name, song.artist);
    if (local?.id) {
      const urlInfo = await getSongUrl(local.id);
      if (urlInfo?.url) {
        const candidate = {
          ...song,
          id: local.id,
          name: local.name,
          artist: local.artist || song.artist,
          album: local.album || song.album,
          coverUrl: local.coverUrl || song.coverUrl,
          duration: local.duration || song.duration || 0,
          url: urlInfo.url,
          _source: 'local',
        };
        const zombie = isZombieSong(candidate);
        if (zombie) {
          console.log(`[chat-zombie] ${local.name} (${local.artist}): ${zombie}`);
          return { ...candidate, playable: false, _zombie: zombie };
        }
        return { ...candidate, playable: true };
      }
      // 本地有但没版权（VIP过期等）
      console.log(`[chat] ${local.name} 在本地歌单中但无法播放`);
    }

    // 3. 兜底：网易云搜索
    const match = await findSong(song.name, song.artist);
    if (match) {
      const urlInfo = await getSongUrl(match.id);
      const candidate = {
        ...song,
        id: match.id,
        name: match.name,
        artist: match.artist || song.artist,
        album: match.album || song.album,
        coverUrl: match.coverUrl || song.coverUrl,
        duration: match.duration || song.duration || 0,
        url: urlInfo?.url || '',
        _source: 'search',
      };
      if (!urlInfo?.url) {
        return { ...candidate, playable: false };
      }
      const zombie = isZombieSong(candidate);
      if (zombie) {
        console.log(`[chat-zombie] ${match.name} (${match.artist}): ${zombie}`);
        return { ...candidate, playable: false, _zombie: zombie };
      }
      return { ...candidate, playable: true };
    }

    // 找不到，返回不可播放
    return { ...song, playable: false };
  } catch (e) {
    console.warn(`[chat] 验证歌曲失败: ${song.name}`, e.message);
    return { ...song, playable: false };
  }
}

/**
 * 清洗播放查询词，去除上下文指代词和冗余修饰
 * "刚刚提到的那首孤独Person" → "孤独Person"
 */
function cleanPlayQuery(query) {
  return query
    .replace(/(?:刚刚|刚才|之前|最近|刚才)\s*(?:提到|说|推荐|放|播|听(?:过)?)\s*(?:的?\s*)?/gi, '')
    .replace(/(?:那首|这首|上一首|下一首)\s*/gi, '')
    .replace(/(?:你说的?|我说的?|它)\s*/gi, '')
    .replace(/^(?:我想听|我要听|想听|听听|播放?|放?)\s*/i, '')
    .trim();
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
      const cleanQuery = cleanPlayQuery(params.query);
      console.log(`[chat] PLAY_NOW 原始: "${params.query}" → 清洗后: "${cleanQuery}"`);
      const match = await findSong(cleanQuery);
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
        ? `用户想听 "${query}" 相关的音乐。请直接推荐 3-5 首歌曲，必须以 JSON 格式返回，play 数组不能为空。`
        : '用户想听点音乐，但没指定具体类型，请根据当前时间、天气和用户的品味来推荐 3-5 首。必须以 JSON 格式返回，play 数组不能为空。';

      // 构建带场景限定的上下文
      const ctx = await buildContext(scenarioPrompt, { weather });

      // 临时替换用户消息为场景限定
      let result = await aiChat(ctx.systemPrompt, ctx.history, scenarioPrompt);

      // 重试：如果 AI 没返回任何歌曲（V3 偶尔只回纯文本），强制要求补歌单
      if (!result.play || result.play.length === 0) {
        console.warn('[chat] PLAYLIST 意图但 AI 未返回歌曲，触发重试...');
        const retryPrompt = `你上一次没有返回歌曲推荐。用户明确要求推荐音乐（"${query || '任意'}"），你必须在 play 数组中返回 3-5 首具体的歌曲（包含 name 和 artist）。只输出 JSON，不要输出其他文字。`;
        result = await aiChat(ctx.systemPrompt, ctx.history, retryPrompt);
      }

      // 验证推荐歌曲（没版权的尝试找替代）
      const verifiedSongs = [];
      for (const song of (result.play || [])) {
        const verified = await verifySong(song);
        if (verified.playable) {
          verifiedSongs.push(verified);
        } else {
          // 没版权或僵尸歌 → 尝试用歌名搜索替代歌曲
          try {
            const match = await findSong(song.name, song.artist);
            if (match) {
              const urlInfo = await getSongUrl(match.id);
              if (urlInfo?.url) {
                const alt = {
                  ...song,
                  id: match.id,
                  name: match.name,
                  artist: match.artist || song.artist,
                  coverUrl: match.coverUrl || song.coverUrl,
                  duration: match.duration || song.duration || 0,
                  url: urlInfo.url,
                };
                if (!isZombieSong(alt)) {
                  verifiedSongs.push({ ...alt, playable: true });
                } else {
                  console.log(`[chat-zombie] 替代歌曲 ${match.name} 也是僵尸歌，跳过`);
                }
              }
            }
          } catch (e) { /* 替代失败，忽略 */ }
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

    // 注意：不再做文本提取兜底。AI 如果想推荐歌会通过 JSON play[] 返回，
    // 从纯文本中用正则提取"歌名"误报率极高（如把引号里的"亲"当歌名）。


    // 验证推荐歌曲（只保留有版权的，没版权的尝试找替代）
    const verifiedSongs = [];
    for (const song of (result.play || [])) {
      const verified = await verifySong(song);
      if (verified.playable) {
        verifiedSongs.push(verified);
      } else {
        // 没版权或僵尸歌 → 尝试用歌名搜索替代歌曲
        console.warn(`[chat] ${song.name} 不可播放，尝试搜索替代...`);
        try {
          const match = await findSong(song.name, song.artist);
          if (match) {
            const urlInfo = await getSongUrl(match.id);
            if (urlInfo?.url) {
              const alt = {
                ...song,
                id: match.id,
                name: match.name,
                artist: match.artist || song.artist,
                coverUrl: match.coverUrl || song.coverUrl,
                duration: match.duration || song.duration || 0,
                url: urlInfo.url,
              };
              if (!isZombieSong(alt)) {
                verifiedSongs.push({ ...alt, playable: true });
              } else {
                console.log(`[chat-zombie] 替代歌曲 ${match.name} 也是僵尸歌，跳过`);
              }
            }
          }
        } catch (e) {
          // 替代失败，忽略
        }
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
