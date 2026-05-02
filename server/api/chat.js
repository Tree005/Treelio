// server/api/chat.js — 对话 API（重构版）
// 接入 router.js 意图分流 + context.js 上下文组装

import { Router } from 'express';
import { chat as aiChat, quickSearch } from '../services/ai.js';
import { getSongUrl, findSong } from '../services/netease.js';
import { findLocal } from '../services/song-index.js';
import { getWeather } from '../services/weather.js';
import { buildContext } from '../context.js';
import { route, INTENT } from '../router.js';
import { getFormattedSchedule } from '../services/calendar.js';
import config from '../config.js';

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

/**
 * 同步 say 和 play：移除 say 中提到了但实际没被验证通过的歌名引用
 * AI 常会写"念欢里这首《嗜好》..."但《嗜好》可能没版权被过滤了
 */
function cleanSay(say, verifiedSongs) {
  if (!say || verifiedSongs.length === 0) return say;

  const verifiedNames = new Set(verifiedSongs.map(s => s.name?.trim()));
  const verifiedArtists = new Set(verifiedSongs.map(s => s.artist?.split('/')[0]?.trim()));

  // 移除 say 中《歌名》但歌名不在 verified 里的引用
  // 比如 "这首《晚安》" → "这首歌"
  let cleaned = say.replace(/《(.+?)》/g, (match, name) => {
    if (verifiedNames.has(name.trim()) || verifiedNames.has(name.replace(/['']/g, '').trim())) {
      return match; // 保留
    }
    return '这首歌';
  });

  // 如果清理后 say 变得很奇怪，回退到更简洁的版本
  const songMentionsInPlay = verifiedSongs.map(s => s.name).join('、');
  if (cleaned.length < say.length * 0.5) {
    // 被大量替换，say 已经破碎了 → 重建
    return `来几首${verifiedSongs.map(s => `${s.name} - ${s.artist}`).join('、')}。`;
  }

  return cleaned;
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
      return res.json({ say: '好的，停止播放。', play: [] });
    }

    // 2. 下一首指令
    if (intent === INTENT.NEXT) {
      return res.json({ say: '好的，下一首。', play: [] });
    }

    // 3. 重播指令
    if (intent === INTENT.REPLAY) {
      return res.json({ say: '好的，再来一遍。', play: [] });
    }

    // 4. 直接播放指令 — 快速路径
    if (intent === INTENT.PLAY_NOW) {
      const cleanQuery = cleanPlayQuery(params.query);
      console.log(`[chat] PLAY_NOW 原始: "${params.query}" → 清洗后: "${cleanQuery}"`);
      const match = await findSong(cleanQuery);
      if (match) {
        const verified = await verifySong({ ...match, name: params.query });
        return res.json({ say: `播放 ${verified.name}，${verified.artist}`, play: [verified] });
      }
      return res.json({ say: `没找到 "${params.query}" 这首歌，换一首试试？`, play: [] });
    }

    // 5. 推荐播放指令 — 走 AI，但加场景限定
    if (intent === INTENT.PLAYLIST) {
      const query = params.query || '';
      const aiProvider = config.aiProvider;

      // 根据后端选择场景提示词风格
      // DeepSeek：硬性要求 play 不能为空（V3 偶尔漏掉）
      // Claude：宽松，让 Claude 自己判断
      const scenarioPrompt = aiProvider === 'claude'
        ? (query
            ? `用户说想听点"${query}"，看看你的推荐。`
            : `用户没具体说想听什么，根据当前时间、天气和品味推荐就好。`)
        : (query
            ? `用户想听 "${query}" 相关的音乐。请直接推荐 3-5 首歌曲，必须以 JSON 格式返回，play 数组不能为空。`
            : '用户想听点音乐，但没指定具体类型，请根据当前时间、天气和用户的品味来推荐 3-5 首。必须以 JSON 格式返回，play 数组不能为空。');

      // 构建带场景限定的上下文
      const ctx = await buildContext(scenarioPrompt, { weather, aiProvider });

      // 临时替换用户消息为场景限定
      let result = await aiChat(ctx.systemPrompt, ctx.history, scenarioPrompt, { aiProvider });

      // 重试（仅 DeepSeek）：如果 AI 没返回任何歌曲，强制要求补歌单
      if (aiProvider !== 'claude' && (!result.play || result.play.length === 0)) {
        console.warn('[chat] PLAYLIST 意图但 AI 未返回歌曲，触发重试...');
        const retryPrompt = `你上一次没有返回歌曲推荐。用户明确要求推荐音乐（"${query || '任意'}"），你必须在 play 数组中返回 3-5 首具体的歌曲（包含 name 和 artist）。只输出 JSON，不要输出其他文字。`;
        result = await aiChat(ctx.systemPrompt, ctx.history, retryPrompt, { aiProvider });
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

      return       res.json({ say: cleanSay(result.say || `来几首 ${query || '适合现在的'} 音乐。`, verifiedSongs), play: verifiedSongs });
    }

    // 6. 日程查询 — 直接调用飞书日历返回，不走 AI
    if (intent === INTENT.SCHEDULE) {
      const dayLabel = params.label || { 0: '今天', 1: '明天', 2: '后天', 3: '大后天' }[params.days] || '那天';
      let scheduleText = await getFormattedSchedule({ days: params.days });
      // 非今天时替换"今日"为对应标签
      if (params.days !== 0) scheduleText = scheduleText.replace('今日', dayLabel);
      return res.json({ say: `${dayLabel}的安排：${scheduleText}`, play: [] });
    }

    // 7. 自然语言 — 完整 AI 对话
    const ctx = await buildContext(message, { weather, aiProvider: config.aiProvider });
    const result = await aiChat(ctx.systemPrompt, ctx.history, message, { aiProvider: config.aiProvider });

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

    res.json({ say: cleanSay(result.say, verifiedSongs), play: verifiedSongs });
  } catch (err) {
    console.error('Chat API 错误:', err);
    res.status(500).json({ error: '服务内部错误' });
  }
});

export default router;
