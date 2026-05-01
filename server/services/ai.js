// server/services/ai.js — DeepSeek API 调用（精简版）
// prompt 组装逻辑已迁移到 server/context.js
// 歌曲验证逻辑在 server/api/chat.js 中处理

import fetch from 'node-fetch';
import config from '../config.js';
import { getDb, saveDb } from '../db/index.js';

/**
 * 调用 DeepSeek API
 * @param {string} systemPrompt - 系统提示词（由 context.js 生成）
 * @param {Array} history - 对话历史 [{role, content}]
 * @param {string} userMessage - 用户输入
 * @returns {Promise<Object>} { say, play[], reason, segue }
 */
export async function chat(systemPrompt, history, userMessage) {
  // 构建 messages
  const messages = [
    { role: 'system', content: systemPrompt },
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
    parsed = {
      say: content,
      play: [],
      reason: '',
      segue: '',
    };
  }

  // 兼容旧字段（如果有的话）
  const result = {
    say: parsed.say || parsed.reply || content,
    play: normalizeSongs(parsed.play || parsed.songs || []),
    reason: parsed.reason || parsed.mood || '',
    segue: parsed.segue || '',
  };

  // 存储对话历史
  const db = await getDb();
  db.run('INSERT INTO conversations (role, content) VALUES (?, ?)', ['user', userMessage]);
  db.run('INSERT INTO conversations (role, content, metadata) VALUES (?, ?, ?)', [
    'assistant',
    result.say,
    JSON.stringify({ play: result.play, reason: result.reason, segue: result.segue }),
  ]);
  saveDb();

  return result;
}

/**
 * 规范化歌曲数组
 * 兼容 {name, artist, id} 格式
 */
function normalizeSongs(songs) {
  if (!Array.isArray(songs)) return [];
  return songs.map(song => ({
    id: song.id || song.songId || '',
    name: song.name || song.songName || '',
    artist: song.artist || song.ar || '',
    album: song.album || song.alName || '',
    coverUrl: song.coverUrl || song.picUrl || song.albumPic || '',
  }));
}

/**
 * 快速搜索单曲（用于直接播放指令）
 * @param {string} query - 搜索词
 * @returns {Promise<Object|null>} 搜索结果
 */
export async function quickSearch(query) {
  if (!query) return null;

  // 这里复用 netease.js 的 findSong，但不做严格验证
  const { findSong } = await import('./netease.js');
  return findSong(query);
}
