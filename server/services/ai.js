// server/services/ai.js — AI 服务统一接口
// 支持 DeepSeek API / Claude CLI 子进程双后端
// 根据 config.aiProvider 自动调度
// 提示词组装由 context.js 负责，歌曲验证由 chat.js 负责

import fetch from 'node-fetch';
import config from '../config.js';
import { getDb, saveDb } from '../db/index.js';
import { askClaude } from './claude.js';

/**
 * AI 对话入口 — 根据配置自动调度 DeepSeek 或 Claude
 * @param {string} systemPrompt - 系统提示词（由 context.js 生成）
 * @param {Array} history - 对话历史 [{role, content}]
 * @param {string} userMessage - 用户输入
 * @param {Object} options - 可选配置
 * @returns {Promise<Object>} { say, play[] }
 */
export async function chat(systemPrompt, history, userMessage, options = {}) {
  if (config.aiProvider === 'claude') {
    return chatWithClaude(systemPrompt, history, userMessage, options);
  }
  return chatWithDeepSeek(systemPrompt, history, userMessage, options);
}

// ========== Claude CLI 子进程后端 ==========

async function chatWithClaude(systemPrompt, history, userMessage, options = {}) {
  const { temperature = 0.2, model = config.claude.model } = options;

  // 组装完整 prompt
  // Claude 不拼接数据库历史——它自己有 D:\Tree\Treelio\JOURNAL.md 管理记忆
  const fullPrompt = systemPrompt + `\n\n用户说：${userMessage}`;

  console.log('[ai-claude] prompt 长度:', fullPrompt.length, '字符');
  console.log('[ai-claude] 模型配置:', model || '默认');

  // 调用 Claude CLI 子进程
  const result = await askClaude(fullPrompt, {
    timeout: config.claude.timeout,
    model: model || undefined,
  });

  console.log('[ai-claude] 解析结果:', JSON.stringify({
    say: result.say?.substring(0, 80),
    playCount: result.play.length,
  }));

  // 存储对话历史（与 DeepSeek 后端一致的存储逻辑）
  const db = await getDb();
  db.run('INSERT INTO conversations (role, content) VALUES (?, ?)', ['user', userMessage]);
  db.run('INSERT INTO conversations (role, content, metadata) VALUES (?, ?, ?)', [
    'assistant',
    result.say || '（回复解析失败）',
    JSON.stringify({ play: result.play }),
  ]);
  saveDb();

  return result;
}

// ========== DeepSeek API 后端 ==========

async function chatWithDeepSeek(systemPrompt, history, userMessage, options = {}) {
  const {
    stream = false,
    temperature = 0.2,
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
  const body = {
    model,
    messages,
    max_tokens: isReasoner ? 8000 : 2000,
    stream,
  };
  if (!isReasoner) {
    body.temperature = temperature;
  }

  // 诊断
  const bodyStr = JSON.stringify(body);
  console.log('[ai-deepseek]', {
    model,
    systemLen: systemPrompt.length,
    historyCount: history.length,
    userMsgLen: userMessage.length,
    totalBodyChars: bodyStr.length,
    estTokens: Math.ceil(bodyStr.length / 2),
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

  // 获取内容
  let content;
  let reasoning = '';
  if (stream) {
    content = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices[0]?.delta || {};
            content += delta.content || '';
            reasoning += delta.reasoning_content || '';
          } catch { /* ignore */ }
        }
      }
    }
  } else {
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
  const parsed = parseDeepSeekResponse(content);
  const result = buildResult(content, parsed);

  // 诊断
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

// ========== JSON 解析工具（DeepSeek 用）==========

/**
 * 5 层防护解析 DeepSeek 的 JSON 输出
 * DeepSeek 有时会在 JSON 外裹 markdown code block、前缀口语文本、截断等
 */
function parseDeepSeekResponse(content) {
  let parsed = null;

  const cleaned = content
    .replace(/```json\s*/gi, '```JSON\n')
    .replace(/```\s*\n?/g, '```')
    .trim();

  // Layer 1: markdown code block
  const codeBlockMatch = cleaned.match(/```JSON\s*\n?([\s\S]*?)```/i);
  if (codeBlockMatch) {
    try { parsed = JSON.parse(codeBlockMatch[1].trim()); } catch {}
  }

  // Layer 2: 括号匹配找最外层完整 JSON
  if (!parsed) {
    let depth = 0, jsonStart = -1, jsonEnd = -1;
    for (let i = cleaned.length - 1; i >= 0; i--) {
      if (cleaned[i] === '}') { if (depth === 0) jsonEnd = i + 1; depth++; }
      else if (cleaned[i] === '{') { depth--; if (depth === 0) jsonStart = i; }
    }
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      try { parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd)); } catch {}
    }
  }

  // Layer 3: 整体解析
  if (!parsed) {
    try { parsed = JSON.parse(cleaned); } catch {}
  }

  // Layer 4: 首尾截取
  if (!parsed) {
    const ls = cleaned.lastIndexOf('{');
    const le = cleaned.lastIndexOf('}');
    if (ls >= 0 && le > ls) {
      try { parsed = JSON.parse(cleaned.slice(ls, le + 1)); } catch {}
    }
  }

  // Layer 5: 移除首尾非 JSON 字符
  if (!parsed) {
    const stripped = cleaned.replace(/^[^{]*/, '').replace(/[^}]*$/, '');
    if (stripped.length > 2) {
      try { parsed = JSON.parse(stripped); } catch {}
    }
  }

  return parsed;
}

/**
 * 从 DeepSeek 原始输出中组装最终结果
 */
function buildResult(content, parsed) {
  let sayText;
  let preambleText = '';

  const cleaned = content
    .replace(/```json\s*/gi, '```JSON\n')
    .replace(/```\s*\n?/g, '```')
    .trim();

  // 提取 preamble（JSON 前的话语）
  const codeBlockMatch = cleaned.match(/```JSON\s*\n?([\s\S]*?)```/i);
  if (codeBlockMatch) {
    preambleText = cleaned.slice(0, codeBlockMatch.index).trim();
  } else {
    let depth = 0, jsonStart = -1, jsonEnd = -1;
    for (let i = cleaned.length - 1; i >= 0; i--) {
      if (cleaned[i] === '}') { if (depth === 0) jsonEnd = i + 1; depth++; }
      else if (cleaned[i] === '{') { depth--; if (depth === 0) jsonStart = i; }
    }
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      preambleText = cleaned.slice(0, jsonStart).trim();
    }
  }

  // 截断检测
  let braceBalance = 0;
  for (const ch of content) {
    if (ch === '{') braceBalance++;
    else if (ch === '}') braceBalance--;
  }
  const isTruncated = braceBalance !== 0;

  if (isTruncated && parsed) {
    console.warn('[ai-warn] content 中存在未闭合的括号 (balance:', braceBalance, ')，可能有截断');
  } else if (isTruncated && !parsed) {
    console.warn('[ai-warn] JSON 被截断 (花括号不匹配)，回退到纯文本');
  }

  if (parsed?.say) {
    sayText = String(parsed.say).trim();
    if (preambleText && preambleText.length > sayText.length * 0.8) {
      sayText = preambleText;
    }
  } else if (preambleText) {
    sayText = preambleText;
  } else {
    sayText = content
      .replace(/```\w*\n?/g, '')
      .replace(/```/g, '')
      .replace(/\{[\s\S]*\}/g, '')
      .replace(/\[\s*\]/g, '')
      .trim()
      .replace(/\n{2,}/g, '\n\n');
  }

  // 安全网
  sayText = sayText.replace(/\n*(?:"(?:reason|segue|play|mood|songs)"\s*:).*/s, '').trim();
  sayText = sayText.replace(/,?\s*\]?\s*$/g, '').trim();
  sayText = sayText.replace(/\n[\s,]*\n/g, '\n').trim();
  sayText = sayText.replace(/^\s*[,\]]+/, '').trim();
  if (!sayText) sayText = '（回复解析失败）';

  return {
    say: sayText,
    play: parsed ? normalizeSongs(parsed.play || parsed.songs || []) : [],
  };
}

/**
 * 规范化歌曲数组
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
