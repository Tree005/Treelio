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
 * @param {Object} options - 可选配置 { stream?, temperature?, model? }
 * @returns {Promise<Object>} { say, play[], reason, segue }
 */
export async function chat(systemPrompt, history, userMessage, options = {}) {
  const {
    stream = false,
    temperature = 0.45,
    model = config.deepseek.model,
  } = options;

  // 构建 messages
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const isReasoner = model.includes('reasoner');

  // 调用 DeepSeek API
  // R1 不支持 temperature 参数，不传
  // R1 reasoning + content 共享 token 额度，R1 reasoning 可能占 2000-5000 tokens
  const body = {
    model,
    messages,
    max_tokens: isReasoner ? 8000 : 2000,
    stream,
  };
  if (!isReasoner) {
    body.temperature = temperature;
  }

  // 诊断：打印请求体大小（字符数 ≈ token 数的 1.5~2 倍中文场景）
  const bodyStr = JSON.stringify(body);
  console.log('[ai-request]', {
    model,
    systemLen: systemPrompt.length,
    historyCount: history.length,
    userMsgLen: userMessage.length,
    totalBodyChars: bodyStr.length,
    estTokens: Math.ceil(bodyStr.length / 2), // 粗估
  });

  const response = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.deepseek.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek API 错误 ${response.status}: ${text}`);
  }

  // 根据模式获取完整内容
  let content;
  let reasoning = '';
  if (stream) {
    // 流式：消费 SSE 事件流，拼装完整内容
    content = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      // 解析 SSE: data: {...}\n\n
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices[0]?.delta || {};
            content += delta.content || '';
            reasoning += delta.reasoning_content || '';
          } catch { /* 忽略解析失败的行 */ }
        }
      }
    }
  } else {
    // 非流式：直接取完整 JSON
    const data = await response.json();
    const msg = data.choices[0]?.message || {};
    content = msg.content || '';
    reasoning = msg.reasoning_content || '';
  }
  if (reasoning) {
    console.log('[ai-reasoning]', reasoning.substring(0, 300));
  }
  console.log('[ai-raw]', content.substring(0, 500));

  // ============ JSON 解析（5 层防护）============
  let parsed = null;
  let preambleText = ''; // JSON 之前的口语文本

  const cleaned = content
    .replace(/```json\s*/gi, '```JSON\n')   // 统一 markdown 标记
    .replace(/```\s*\n?/g, '```')            // 合并多余 backtick
    .trim();

  // Layer 1: 从 markdown code block 中提取 JSON
  const codeBlockMatch = cleaned.match(/```JSON\s*\n?([\s\S]*?)```/i);
  if (codeBlockMatch) {
    preambleText = cleaned.slice(0, codeBlockMatch.index).trim();
    try { parsed = JSON.parse(codeBlockMatch[1].trim()); } catch {}
  }

  // Layer 2: 找最后一个完整的 JSON 对象（处理 "说点话。{...}" 格式）
  if (!parsed) {
    // 用括号匹配找最外层完整的 { ... }
    let depth = 0, jsonStart = -1, jsonEnd = -1;
    for (let i = cleaned.length - 1; i >= 0; i--) {
      if (cleaned[i] === '}') { if (depth === 0) jsonEnd = i + 1; depth++; }
      else if (cleaned[i] === '{') { depth--; if (depth === 0) jsonStart = i; }
    }
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      preambleText = cleaned.slice(0, jsonStart).trim();
      try { parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd)); } catch {}
    }
  }

  // Layer 3: 整体直接解析（纯 JSON 响应）
  if (!parsed) {
    try { parsed = JSON.parse(cleaned); } catch {}
  }

  // Layer 4: 用最后一个 { 和最后一个 } 截取（兼容带后缀的 JSON）
  if (!parsed) {
    const ls = cleaned.lastIndexOf('{');
    const le = cleaned.lastIndexOf('}');
    if (ls >= 0 && le > ls) {
      preambleText = cleaned.slice(0, ls).trim();
      try { parsed = JSON.parse(cleaned.slice(ls, le + 1)); } catch {}
    }
  }

  // Layer 5: 如果还是失败，尝试移除首尾可能的残留字符再整体解析
  if (!parsed) {
    const stripped = cleaned.replace(/^[^{]*/, '').replace(/[^}]*$/, '');
    if (stripped.length > 2) {
      try { parsed = JSON.parse(stripped); } catch {}
    }
  }

  // ============ 组装最终输出 ============
  let sayText;

  // 截断检测：检查原始 content 中花括号是否配对
  let braceBalance = 0;
  let maxBrace = 0;
  for (const ch of content) {
    if (ch === '{') braceBalance++;
    else if (ch === '}') braceBalance--;
    maxBrace = Math.max(maxBrace, braceBalance);
  }
  const isTruncated = braceBalance !== 0; // 不归零说明 JSON 被截断

  if (isTruncated && parsed) {
    // 表面上 JSON.parse 成功了，但原始文本有未闭合的括号
    // 可能是 R1 先输出了一段完整 JSON 后又写了新的不完整 JSON
    // 保留已解析的结果，但打告警
    console.warn('[ai-warn] content 中存在未闭合的括号 (balance:', braceBalance, ')，可能有截断');
  } else if (isTruncated && !parsed) {
    // 确实截断了，JSON 解析失败
    console.warn('[ai-warn] JSON 被截断 (花括号不匹配)，已回退到纯文本');
  }

  if (parsed?.say) {
    sayText = String(parsed.say).trim();
    // 如果 preamble 有独立的有意义文本，优先用 preamble
    if (preambleText && preambleText.length > sayText.length * 0.8) {
      sayText = preambleText;
    }
  } else if (preambleText) {
    // JSON 解析失败（截断或其他原因）→ 用 preamble
    sayText = preambleText;
  } else {
    // 完全无法解析 → 从原文剥离 JSON 残留
    sayText = content
      .replace(/```\w*\n?/g, '')
      .replace(/```/g, '')
      .replace(/\{[\s\S]*\}/g, '')
      .replace(/\[\s*\]/g, '')
      .trim()
      .replace(/\n{2,}/g, '\n\n');
  }

  // 安全网：移除 say 中可能混入的 JSON 片段
  sayText = sayText.replace(/\n*(?:"(?:reason|segue|play|mood|songs)"\s*:).*/s, '').trim();
  sayText = sayText.replace(/,?\s*\]?\s*$/g, '').trim();
  // 移除纯逗号/方括号组成的残留行（截断的数组碎片）
  sayText = sayText.replace(/\n[\s,]*\n/g, '\n').trim();
  sayText = sayText.replace(/^\s*[,\]]+/, '').trim();
  if (!sayText) sayText = '（回复解析失败）';

  const result = {
    say: sayText,
    play: parsed ? normalizeSongs(parsed.play || parsed.songs || []) : [],
  };

  // 诊断日志
  console.log('[ai-parsed]', JSON.stringify({
    say: result.say?.substring(0, 80),
    playCount: result.play.length,
  }));

  // 存储对话历史
  const db = await getDb();
  db.run('INSERT INTO conversations (role, content) VALUES (?, ?)', ['user', userMessage]);
  db.run('INSERT INTO conversations (role, content, metadata) VALUES (?, ?, ?)', [
    'assistant',
    result.say,
    JSON.stringify({ play: result.play }),
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
    duration: song.duration || 0,
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
