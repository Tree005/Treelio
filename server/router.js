// server/router.js — 意图分流模块
// 直接播放指令走快速路径，自然语言走 AI
//
// 优先级顺序（硬性）：
//   1. STOP / NEXT / REPLAY（精确匹配关键词）
//   2. PLAYLIST — 量词优先（消息含"几首/两首/点"等 → 推荐多首）
//   3. PLAY_NOW — 指定歌曲（"播放xxx/来首xxx/想听xxx" → 搜歌）
//   4. PLAYLIST — 其他推荐表达（"推荐xxx/有没有xxx"）
//   5. QUEUE
//   6. SCHEDULE — 日程查询
//   7. CHAT（兜底）

import { extractDateFromPrefix } from './services/date-parser.js';

/**
 * 意图类型枚举
 */
export const INTENT = {
  PLAY_NOW: 'play_now',      // "播放xxx" — 立即播放
  PLAYLIST: 'playlist',      // "来几首xxx" / "播放列表xxx" — 推荐播放
  CHAT: 'chat',             // 自然语言 — 走 AI
  QUEUE: 'queue',           // "加到队列" — 添加到队列
  STOP: 'stop',             // "停止" / "暂停" — 停止播放
  NEXT: 'next',             // "下一首" — 切到下一首
  REPLAY: 'replay',         // "重播" / "再放一遍" — 重播当前
  SCHEDULE: 'schedule',     // "明天有什么安排" — 查飞书日程
};

/**
 * PLAY_NOW 动作前缀（消息以这些开头 → 搜歌播放）
 */
const PLAY_NOW_PREFIXES = [
  /^我再?(?:播放|播|放|播一下|放一下)\s*(.+)/i,
  /^再?播放\s*(.+)/i,
  /^播(?:一下)?\s*(.+)/i,
  /^放(?:一下)?\s*(.+)/i,
  /^(?:我?想听|我要听|听听)\s*(.+)/i,
  /^来(?:首|一首)\s*(.+)/i,
  /^放(?:首|一首)\s*(.+)/i,
];

/**
 * 正则量词：用户说要"几首"、"两首"、"3首" → 推荐多首
 * 注意：不包含"一首"（那是单曲播放）
 */
const QUANTIFIER_RE = /[几两三四五六七八九十\d]+首/;
// "想听点xx"/"放点xx" — "点"作为量词需要前面有动作动词（防误判"有点"）
const POINT_AS_QUANTIFIER_RE = /^(?:我?想听|来|放|播)点/i;
const QUANTIFIER_QUERY_RE = /(?:[几两三四五六七八九十\d]+首|点)\s*/i;

/**
 * 判断是否是停止指令
 */
function isStopCommand(text) {
  return [/^停止$/i, /^暂停$/i, /^stop$/i, /^pause$/i, /^关掉$/i, /^不听了$/i]
    .some(p => p.test(text));
}

/**
 * 判断是否是下一首指令
 */
function isNextCommand(text) {
  return [/^下一首$/i, /^下一曲$/i, /^next$/i, /^跳到下一首$/i, /^切到下一首$/i]
    .some(p => p.test(text));
}

/**
 * 判断是否是重播指令
 */
function isReplayCommand(text) {
  return [/^重播$/i, /^再放一遍$/i, /^再来一遍$/i, /^replay$/i, /^repeat$/i, /^重新播放$/i]
    .some(p => p.test(text));
}

/**
 * 检测消息是否包含播放量词（"来几首""多来几首""想听两首"等）
 * 有量词 → 应该走 PLAYLIST，而不是搜歌名
 */
function hasQuantityQualifier(text) {
  return QUANTIFIER_RE.test(text) || POINT_AS_QUANTIFIER_RE.test(text);
}

/**
 * 从量词表达中提取场景关键词
 * "来几首中文歌" → "中文歌"
 * "多来两首纯音乐" → "纯音乐"
 * "点" 只在有 来/放/播 前缀时提取
 */
function extractPlaylistQuery(text) {
  // 先找动作动词位置
  const actionMatch = text.match(/(?:来|放|播|推荐|听)\s*$/);
  // 从量词/点后面截取
  const m = text.match(QUANTIFIER_QUERY_RE);
  if (m) {
    return text.slice(m.index + m[0].length).trim();
  }
  return text;
}

/**
 * 意图分流函数
 * @param {string} message - 用户输入
 * @returns {{ intent: string, params: Object }} 意图类型和参数
 */
export function route(message) {
  if (!message || typeof message !== 'string') {
    return { intent: INTENT.CHAT, params: {} };
  }

  const text = message.trim();

  // ========== 1. 高优先级指令 ==========

  if (isStopCommand(text))  return { intent: INTENT.STOP, params: {} };
  if (isNextCommand(text))  return { intent: INTENT.NEXT, params: {} };
  if (isReplayCommand(text)) return { intent: INTENT.REPLAY, params: {} };

  // ========== 2. 量词优先（必须在 PLAY_NOW 之前）==========
  // "多来几首/放两首/想听几首/来点/再来几首" → PLAYLIST
  // 这些不应该被 play now 拦截去搜歌名

  if (hasQuantityQualifier(text)) {
    return {
      intent: INTENT.PLAYLIST,
      params: { query: extractPlaylistQuery(text) },
    };
  }

  // ========== 3. 指定歌单指令（PLAYLIST，必须放在 PLAY_NOW 之前）==========

  // "播放列表xxx" / "歌单xxx" / "歌库xxx"
  const playlistNameMatch = text.match(/^(?:播放列表?|歌单|歌库)\s*(.+)/i);
  if (playlistNameMatch) {
    return {
      intent: INTENT.PLAYLIST,
      params: { query: playlistNameMatch[1].trim(), type: 'playlist' },
    };
  }

  // ========== 4. 指定歌曲指令（PLAY_NOW）==========
  // 到这里的消息已经不含量词，不会被误匹配

  // "我想听xxx" / "想听xxx" / "我要听xxx" / "听听xxx"
  const wantPlayMatch = text.match(/^(?:我?想听|我要听|听听)\s*(.+)/i);
  if (wantPlayMatch) {
    return {
      intent: INTENT.PLAY_NOW,
      params: { query: wantPlayMatch[1].trim() },
    };
  }

  // "播放xxx" / "播xxx" / "放xxx" / "播一下xxx" / "放一下xxx"
  // "来首xxx" / "放首xxx" / "一首xxx"
  const playNowMatch = text.match(/^(?:再?(?:播放|播|放|播一下|放一下)|来(?:首|一首)|放(?:首|一首))\s*(.+)/i);
  if (playNowMatch) {
    return {
      intent: INTENT.PLAY_NOW,
      params: { query: playNowMatch[1].trim() },
    };
  }

  // ========== 4. 推荐类指令（PLAYLIST）==========

  // "来xxx" / "来点xxx" — 纯"来"开头但没量词的推荐（如"来点轻松的"）
  let playlistMatch = text.match(/^(?:来|来点)\s*(.+)?$/i);
  if (playlistMatch && playlistMatch[1]) {
    return {
      intent: INTENT.PLAYLIST,
      params: { query: playlistMatch[1].trim() },
    };
  }

  // "推荐xxx" / "推荐几首xxx" / "推荐点xxx"
  playlistMatch = text.match(/^(?:推荐)\s*(.+)?$/i);
  if (playlistMatch) {
    return {
      intent: INTENT.PLAYLIST,
      params: { query: playlistMatch[1]?.trim() || '' },
    };
  }

  // "有没有/有什么推荐的xxx"
  playlistMatch = text.match(/^(?:有没有|有什么)推荐的(?:歌|音乐)?(?:[，,?\s]+(.+))?$/i);
  if (playlistMatch) {
    return {
      intent: INTENT.PLAYLIST,
      params: { query: playlistMatch[1]?.trim() || '' },
    };
  }

  // ========== 5. 队列类指令 ==========

  if (text.includes('加到队列') || text.includes('加入队列') || text.includes('添到队列')) {
    return { intent: INTENT.QUEUE, params: {} };
  }

  // ========== 6. 日程查询 ==========
  // 路径A: 快速正则（今天/明天/后天/大后天）

  const scheduleMatch = text.match(/^(今天|明天|后天|大后天)\s*(?:有什么|啥|的)?\s*(?:安排|行程|日程|计划)?\s*[?？]?$/i);
  if (scheduleMatch) {
    const dayMap = { '今天': 0, '明天': 1, '后天': 2, '大后天': 3 };
    return {
      intent: INTENT.SCHEDULE,
      params: { days: dayMap[scheduleMatch[1]] ?? 0 },
    };
  }

  // 路径B: 解析器识别（这周三/下周四/5月5号/这个月15号/下个月4号...）
  const extracted = extractDateFromPrefix(text);
  if (extracted) {
    const rest = text.slice(extracted.matchLength).trim();
    // 剩余部分为空，或是日程查询关键词
    if (!rest || /^(?:有什么|啥|的)?\s*(?:安排|行程|日程|计划|事情|事)?\s*[?？]?$/i.test(rest)) {
      return {
        intent: INTENT.SCHEDULE,
        params: { days: extracted.days, label: extracted.label },
      };
    }
  }

  // 路径C: 带前缀的日程查询（帮我查一下/查查/看看 这周三...）
  const prefixMatch = text.match(/^(?:查(?:一下|查)?|看(?:一下|看)?|帮我查(?:一下)?)\s*(.+)$/i);
  if (prefixMatch) {
    const inner = extractDateFromPrefix(prefixMatch[1]);
    if (inner) {
      const rest = prefixMatch[1].slice(inner.matchLength).trim();
      if (!rest || /^(?:有什么|啥|的)?\s*(?:安排|行程|日程|计划|事情|事)?\s*[?？]?$/i.test(rest)) {
        return {
          intent: INTENT.SCHEDULE,
          params: { days: inner.days, label: inner.label },
        };
      }
    }
  }

  // ========== 7. 自然语言（兜底）==========

  return { intent: INTENT.CHAT, params: {} };
}

/**
 * 判断是否是自然语言（需要 AI 处理）
 * @param {string} text - 用户输入
 * @returns {boolean}
 */
export function isNaturalLanguage(text) {
  const chatPatterns = [
    /[？?]$/,                           // 以问号结尾
    /^(?:怎么|为什么|什么|哪|谁|如何)/,   // 疑问词开头
    /^(?:我想|我想要|我要)/,              // 表达需求
    /^(?:今天|现在|此刻)/,                // 时间相关
    /^(?:心情|情绪|感觉)/,                // 情绪相关
  ];
  return chatPatterns.some(p => p.test(text));
}
