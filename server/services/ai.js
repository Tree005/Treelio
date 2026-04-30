// server/services/ai.js — DeepSeek API 调用 + prompt 组装
import fetch from 'node-fetch';
import { readFileSync } from 'fs';
import config from '../config.js';
import { getDb, saveDb } from '../db/index.js';
import { findSong } from './netease.js';

// 读取用户歌单语料
const corpusPath = config.dataDir + '/user-corpus.json';
let corpusSummary = '';
try {
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf-8'));
  const songs = corpus.platforms?.netease?.songs || [];
  // 提取前 50 首作为品味参考
  const sample = songs.slice(0, 50).map(s => `${s.name} - ${s.artist}`).join('\n');
  corpusSummary = `用户歌单共 ${corpus.stats?.totalSongs || songs.length} 首，部分代表作：\n${sample}`;
} catch (e) {
  console.warn('无法读取歌单语料:', e.message);
}

const SYSTEM_PROMPT = `你是 Treelio，一个有品位的私人电台 DJ。你不是冷冰冰的 AI 助手，你是一个有自己态度的音乐爱好者。

## 你的风格
- 说话简练有温度，像老朋友推荐歌
- 不说废话，不谄媚，不夸用户
- 可以对音乐有自己的看法和偏好
- 中英文混杂没问题，自然就好
- 偶尔会根据时间和天气营造氛围

## 你的能力
- 根据用户的品味、心情、场景推荐音乐
- 聊音乐、聊氛围、聊情绪
- 能搜索网易云音乐库

## 用户品味
${corpusSummary}

## 输出格式
你必须返回合法的 JSON（不要 markdown code block），格式如下：
{
  "reply": "你的回复文字，像 DJ 说话一样",
  "songs": [
    { "name": "歌曲名", "artist": "艺人名", "id": "网易云歌曲ID（数字字符串）" }
  ],
  "mood": "当前氛围标签，如 chill, focus, energetic, melancholy, romantic"
}

示例（推荐多首歌的正确格式）：
{"reply":"今天适合点慵懒的。《Summertime Sadness》Lana 的经典，加上《Coffee》beabadoobee 的温暖，再配一首《Redbone》增加点律动。","songs":[{"name":"Summertime Sadness","artist":"Lana Del Rey","id":"167876"},{"name":"Coffee","artist":"beabadoobee","id":"1462774166"},{"name":"Redbone","artist":"Childish Gambino","id":"435981049"}],"mood":"chill"}

重要规则（必须严格遵守）：
- reply 是必须的，songs 是可选的（只有推荐歌曲时才填）
- **默认推荐 2-3 首歌，让用户有选择的余地**。只有用户明确说"就一首"或"来一首"时才推 1 首
- **songs 数组必须包含你在 reply 中提到的每一首歌，一个都不能漏。这是硬性要求**
- 每首歌给出 name、artist，id 可以留空（系统会自动匹配）
- 如果用户明确要求播放某首歌，必须把那首歌放进 songs 数组
- 如果用户没要推荐歌，songs 填空数组 []
- 不要假装"正在播放"某首歌，除非你确实把它放进 songs 数组里了
- mood 始终给出一个`;

export async function chat(userMessage, context = {}) {
  const db = await getDb();

  // 读取最近 20 条对话历史
  const historyRows = db.exec(
    'SELECT role, content FROM conversations ORDER BY id DESC LIMIT 20'
  );
  const history = historyRows.length > 0
    ? historyRows[0].values.slice().reverse().map(([role, content]) => ({ role, content }))
    : [];

  // 组装上下文
  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  let contextInfo = `\n\n## 当前上下文\n- 时间：${timeStr}`;
  if (context.weather) {
    contextInfo += `\n- 天气：${context.weather}`;
  }

  // 构建 messages
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT + contextInfo },
    ...history,
    { role: 'user', content: userMessage },
  ];

  // 调用 DeepSeek API
  const response = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.deepseek.apiKey}`,
    },
    body: JSON.stringify({
      model: config.deepseek.model,
      messages,
      temperature: 0.8,
      max_tokens: 1500,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek API 错误 ${response.status}: ${text}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || '';
  console.log('[ai-raw]', content.substring(0, 500));

  // 解析 JSON（尝试去除可能的 markdown code block）
  let parsed;
  try {
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    // 解析失败时回退为纯文本回复
    parsed = { reply: content, songs: [], mood: 'neutral' };
  }

  // 兜底：从 reply 文本中提取歌名，补充到 songs 数组
  const replyText = parsed.reply || '';
  const mentionedNames = new Set();

  // 匹配《歌名》格式
  (replyText.match(/《(.+?)》/g) || []).forEach(m => mentionedNames.add(m.slice(1, -1)));
  // 匹配引号格式：「」 " " ' ' \u201c\u201d
  (replyText.match(/["「'\u201c](.+?)["」'\u201d]/g) || []).forEach(m => mentionedNames.add(m.slice(1, -1)));

  if (mentionedNames.size > 0 && Array.isArray(parsed.songs)) {
    const existingNames = new Set(parsed.songs.map(s => (s.name || '').toLowerCase()));
    for (const name of mentionedNames) {
      if (existingNames.has(name.toLowerCase())) continue;
      if (name.length < 2) continue;
      parsed.songs.push({ name, artist: '', _extracted: true });
      console.log(`[song-extract] 📌 从文本提取: ${name}`);
    }
  }

  // 验证歌曲：用网易云搜索 API 替换 AI 编造的 ID（含兜底提取的歌）
  if (Array.isArray(parsed.songs) && parsed.songs.length > 0) {
    const verified = [];
    for (const song of parsed.songs) {
      if (!song.name) continue;
      try {
        const match = await findSong(song.name, song.artist);
        if (match) {
          verified.push({
            id: match.id,
            name: match.name,
            artist: song.artist || match.artist,
            album: match.album || '',
            coverUrl: match.coverUrl || '',
          });
          console.log(`[song-verify] ✅ ${song.name} → id=${match.id}`);
        } else {
          // 搜索无结果，保留原始信息但标记不可播放
          verified.push({ ...song, id: song.id || '', playable: false });
          console.warn(`[song-verify] ⚠️ ${song.name} 未找到匹配`);
        }
      } catch (err) {
        verified.push({ ...song, playable: false });
        console.error(`[song-verify] ❌ ${song.name} 搜索失败:`, err.message);
      }
    }
    parsed.songs = verified;
  }

  // 存对话历史
  db.run('INSERT INTO conversations (role, content) VALUES (?, ?)', ['user', userMessage]);
  db.run('INSERT INTO conversations (role, content, metadata) VALUES (?, ?, ?)', [
    'assistant', parsed.reply, JSON.stringify({ songs: parsed.songs, mood: parsed.mood })
  ]);
  saveDb();

  return parsed;
}
