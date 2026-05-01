// server/context.js — 6片 Prompt 组装模块
// 输入：用户语料 + 天气 + 时间 + 历史记录 + 用户输入
// 输出：结构化上下文 {say, play[], reason, segue}

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import { getDb } from './db/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============ 1. 读取语料文件 ============

/**
 * 读取 markdown 语料文件
 * @param {string} filename - 文件名（不含路径）
 * @returns {string} 文件内容
 */
function readCorpusFile(filename) {
  const userDir = resolve(__dirname, '..', 'user');
  const filepath = resolve(userDir, filename);
  if (!existsSync(filepath)) {
    return '';
  }
  try {
    return readFileSync(filepath, 'utf-8');
  } catch (e) {
    console.warn(`[context] 读取 ${filename} 失败:`, e.message);
    return '';
  }
}

/**
 * 读取歌单语料摘要
 */
function getCorpusSummary() {
  const corpusPath = resolve(config.dataDir, 'user-corpus.json');
  try {
    if (!existsSync(corpusPath)) {
      return '（暂无歌单数据）';
    }
    const corpus = JSON.parse(readFileSync(corpusPath, 'utf-8'));
    const songs = corpus.platforms?.netease?.songs || [];
    if (songs.length === 0) {
      return '（暂无歌单数据）';
    }
    // 提取前 30 首作为品味参考
    const sample = songs.slice(0, 30).map(s => `${s.name} - ${s.artist}`).join('\n');
    return `用户歌单共 ${corpus.stats?.totalSongs || songs.length} 首，部分代表作：\n${sample}`;
  } catch (e) {
    console.warn('[context] 读取歌单语料失败:', e.message);
    return '（暂无歌单数据）';
  }
}

// ============ 2. 片 1: 角色定义 ============

/**
 * 生成角色片 prompt
 */
function buildRoleFragment(tasteContent, moodRulesContent) {
  const taste = tasteContent || '（未配置）';
  const moodRules = moodRulesContent || '（未配置）';

  return `你是 Treelio，一个有品位的私人电台 DJ。你不是冷冰冰的 AI 助手，你是一个有自己态度的音乐爱好者。

## 你的风格
- 说话简练有温度，像老朋友推荐歌
- 不说废话，不谄媚，不夸用户
- 可以对音乐有自己的看法和偏好
- 中英文混杂没问题，natural 就好
- 偶尔会根据时间和天气营造氛围

## 用户品味偏好
${taste}

## 情绪音乐映射规则
${moodRules}`;
}

// ============ 3. 片 2: 时间片 ============

/**
 * 生成时间片 prompt
 */
function buildTimeFragment(timeInfo) {
  const { hour, weekday, isWeekend } = timeInfo;
  const dayType = isWeekend ? '周末' : '工作日';
  const period = getTimePeriod(hour);

  return `## 当前时间
- ${period}，${dayType}
- ${weekday}`;
}

/**
 * 根据小时判断时段
 */
function getTimePeriod(hour) {
  if (hour >= 6 && hour < 9) return '清晨';
  if (hour >= 9 && hour < 12) return '上午';
  if (hour >= 12 && hour < 14) return '午后';
  if (hour >= 14 && hour < 18) return '下午';
  if (hour >= 18 && hour < 20) return '傍晚';
  if (hour >= 20 && hour < 23) return '夜晚';
  return '深夜';
}

// ============ 4. 片 3: 天气片 ============

/**
 * 生成天气片 prompt
 */
function buildWeatherFragment(weather) {
  if (!weather) {
    return '## 天气\n（暂无天气数据）';
  }
  return `## 天气\n${weather}`;
}

// ============ 5. 片 4: 品味片 ============

/**
 * 生成品味片 prompt
 */
function buildTasteFragment(corpusSummary) {
  return `## 用户歌单品味
${corpusSummary}`;
}

// ============ 6. 片 5: 历史片 ============

/**
 * 生成历史片 prompt
 * @param {Array} history - 对话历史 [{role, content}]
 */
function buildHistoryFragment(history) {
  if (!history || history.length === 0) {
    return '## 对话历史\n（暂无历史记录）';
  }

  const lines = ['## 对话历史'];
  for (const msg of history) {
    const role = msg.role === 'user' ? '用户' : 'DJ';
    lines.push(`[${role}] ${msg.content}`);
  }
  return lines.join('\n');
}

// ============ 7. 片 6: 格式片 ============

/**
 * 生成格式片 prompt
 */
function buildFormatFragment() {
  return `## 输出格式
你必须返回合法的 JSON（不要 markdown code block），格式如下：
{
  "say": "DJ 的播报文字，像电台主持一样自然地说话",
  "play": [
    { "name": "歌曲名", "artist": "艺人名", "id": "网易云歌曲ID（数字字符串，可选）" }
  ],
  "reason": "推荐这首歌的理由，简短一句话",
  "segue": "转场语，连接上下曲用的过渡语（可为空）"
}

规则（必须遵守）：
- say 是必须的，play 是可选的（只有推荐歌曲时才填）
- **只要你推荐或提到歌曲，必须把每一首都填入 play 数组**
- **play 数组里有的歌才能在 say 里提到，say 和 play 必须一致**
- reason 简短描述推荐理由，如"这首歌的节奏很适合现在"
- segue 是转场语，比如"好，休息一下"（可为空字符串）
- 如果用户没要推荐歌，play 填空数组 []
- 不要假装"正在播放"某首歌，除非你确实把它放进 play 数组里了
- mood 字段不再使用，请在 reason 中表达情绪

## 示例
用户："来几首适合写代码的"
你应该返回：
{
  "say": "写代码需要点节奏感，这几首应该合适。",
  "play": [
    { "name": "Computer Love", "artist": "Zapp" },
    { "name": "Digital Love", "artist": "Daft Punk" },
    { "name": "Derezzed", "artist": "Daft Punk" }
  ],
  "reason": "电子合成器的节奏感让人保持专注",
  "segue": ""
}`;
}

// ============ 主函数 ============

/**
 * 构建完整的 prompt 上下文
 * @param {string} userMessage - 用户输入
 * @param {Object} options - 可选参数
 * @param {string} options.weather - 天气信息
 * @returns {Promise<Object>} 包含 systemPrompt 和 history
 */
export async function buildContext(userMessage, options = {}) {
  const { weather } = options;

  // 并行读取语料文件
  const [tasteContent, routinesContent, moodRulesContent] = await Promise.all([
    Promise.resolve(readCorpusFile('taste.md')),
    Promise.resolve(readCorpusFile('routines.md')),
    Promise.resolve(readCorpusFile('mood-rules.md')),
  ]);

  // 获取歌单语料摘要
  const corpusSummary = getCorpusSummary();

  // 获取对话历史
  const db = await getDb();
  const historyRows = db.exec(
    'SELECT role, content FROM conversations ORDER BY id DESC LIMIT 20'
  );
  const history = historyRows.length > 0
    ? historyRows[0].values.slice().reverse().map(([role, content]) => ({ role, content }))
    : [];

  // 构建时间信息
  const now = new Date();
  const timeInfo = {
    hour: now.getHours(),
    weekday: now.toLocaleDateString('zh-CN', { weekday: 'long' }),
    isWeekend: [0, 6].includes(now.getDay()),
  };

  // 组装 6 片
  const fragments = [
    buildRoleFragment(tasteContent, moodRulesContent),
    buildTimeFragment(timeInfo),
    buildWeatherFragment(weather),
    buildTasteFragment(corpusSummary),
    buildHistoryFragment(history),
    buildFormatFragment(),
  ];

  const systemPrompt = fragments.join('\n\n');

  return {
    systemPrompt,
    history,
    timeInfo,
    weather,
    corpusSummary,
  };
}

/**
 * 获取时间信息
 */
export function getTimeInfo() {
  const now = new Date();
  return {
    hour: now.getHours(),
    weekday: now.toLocaleDateString('zh-CN', { weekday: 'long' }),
    isWeekend: [0, 6].includes(now.getDay()),
    dateStr: now.toLocaleString('zh-CN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}
