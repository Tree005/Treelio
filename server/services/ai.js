// server/services/ai.js — DeepSeek API 调用 + prompt 组装
import fetch from 'node-fetch';
import { readFileSync } from 'fs';
import config from '../config.js';
import { getDb, saveDb } from '../db/index.js';

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

规则：
- reply 是必须的，songs 是可选的（只有推荐歌曲时才填）
- 如果你想推荐歌曲，尽量给出精确的 name 和 artist，id 可以后端帮你搜
- 如果用户没要推荐歌，songs 填空数组 []
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
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek API 错误 ${response.status}: ${text}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || '';

  // 解析 JSON（尝试去除可能的 markdown code block）
  let parsed;
  try {
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    // 解析失败时回退为纯文本回复
    parsed = { reply: content, songs: [], mood: 'neutral' };
  }

  // 存对话历史
  db.run('INSERT INTO conversations (role, content) VALUES (?, ?)', ['user', userMessage]);
  db.run('INSERT INTO conversations (role, content, metadata) VALUES (?, ?, ?)', [
    'assistant', parsed.reply, JSON.stringify({ songs: parsed.songs, mood: parsed.mood })
  ]);
  saveDb();

  return parsed;
}
