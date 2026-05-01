// server/router.js — 意图分流模块
// 直接播放指令走快速路径，自然语言走 AI

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
};

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

  // ========== 高优先级指令 ==========

  // 停止/暂停
  if (isStopCommand(text)) {
    return { intent: INTENT.STOP, params: {} };
  }

  // 下一首
  if (isNextCommand(text)) {
    return { intent: INTENT.NEXT, params: {} };
  }

  // 重播
  if (isReplayCommand(text)) {
    return { intent: INTENT.REPLAY, params: {} };
  }

  // ========== 播放类指令 ==========

  // "播放xxx" — 直接播放
  const playNowMatch = text.match(/^(?:播放|播|放|播一下|放一下)\s*(.+)/i);
  if (playNowMatch) {
    return {
      intent: INTENT.PLAY_NOW,
      params: { query: playNowMatch[1].trim() },
    };
  }

  // "来几首xxx" / "推荐xxx" — 推荐播放
  const playlistMatch = text.match(/^(?:来(?:几首|点)?|推荐|给我来|放(?:几首|点)?|播(?:几首|点)?)\s*(.+)?/i);
  if (playlistMatch) {
    return {
      intent: INTENT.PLAYLIST,
      params: { query: playlistMatch[1]?.trim() || '' },
    };
  }

  // "播放列表xxx" — 播放指定歌单
  const playlistNameMatch = text.match(/^(?:播放列表?|歌单|歌库)\s*(.+)/i);
  if (playlistNameMatch) {
    return {
      intent: INTENT.PLAYLIST,
      params: { query: playlistNameMatch[1].trim(), type: 'playlist' },
    };
  }

  // ========== 队列类指令 ==========

  // "加到队列" / "加入队列" — 添加到队列
  if (text.includes('加到队列') || text.includes('加入队列') || text.includes('添到队列')) {
    return { intent: INTENT.QUEUE, params: {} };
  }

  // ========== 自然语言（走 AI） ==========
  // 其他所有输入都走 AI 对话

  return { intent: INTENT.CHAT, params: {} };
}

/**
 * 判断是否是停止指令
 */
function isStopCommand(text) {
  const patterns = [
    /^停止$/i,
    /^暂停$/i,
    /^stop$/i,
    /^pause$/i,
    /^关掉$/i,
    /^不听了$/i,
  ];
  return patterns.some(p => p.test(text));
}

/**
 * 判断是否是下一首指令
 */
function isNextCommand(text) {
  const patterns = [
    /^下一首$/i,
    /^下一曲$/i,
    /^next$/i,
    /^跳到下一首$/i,
    /^切到下一首$/i,
  ];
  return patterns.some(p => p.test(text));
}

/**
 * 判断是否是重播指令
 */
function isReplayCommand(text) {
  const patterns = [
    /^重播$/i,
    /^再放一遍$/i,
    /^再来一遍$/i,
    /^replay$/i,
    /^repeat$/i,
    /^重新播放$/i,
  ];
  return patterns.some(p => p.test(text));
}

/**
 * 判断是否是自然语言（需要 AI 处理）
 * @param {string} text - 用户输入
 * @returns {boolean}
 */
export function isNaturalLanguage(text) {
  // 如果是自然语言问题/聊天内容，返回 true
  const chatPatterns = [
    /[？?]$/,                    // 以问号结尾
    /^(?:怎么|为什么|什么|哪|谁|如何)/,  // 疑问词开头
    /^(?:我想|我想要|我要)/,     // 表达需求
    /^(?:今天|现在|此刻)/,       // 时间相关
    /^(?:心情|情绪|感觉)/,       // 情绪相关
  ];
  return chatPatterns.some(p => p.test(text));
}
