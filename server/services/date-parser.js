// server/services/date-parser.js — 中文日期表达式解析器
// 将"这周三/下周四/5月5号/这个月15号"等转为距今天数偏移

// 星期映射：'一' → 1 (周一) ... '日'/'天' → 7 (周日)
const WEEKDAY_CN = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '日': 7, '天': 7 };
const WEEKDAY_EN = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7 };

// 月份中文映射
const MONTH_CN = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12 };

/**
 * 将 JS getDay() 转 ISO 星期（1=周一, 7=周日）
 */
function toIsoWeekday(jsDay) {
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * 获取今天凌晨的 Date 对象
 */
function getToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * 计算目标日期距今天的天数偏移
 * @param {Date} targetDate - 目标日期
 * @returns {number} 天数偏移（0=今天，正=未来，负=过去）
 */
function daysFromToday(targetDate) {
  const today = getToday();
  return Math.round((targetDate - today) / (24 * 60 * 60 * 1000));
}

/**
 * 创建日期，超出当月天数时自动截断到当月最后一天
 * @param {number} year
 * @param {number} month - 0-based (0=1月)
 * @param {number} day
 * @param {string} [label] - 可选，传 label 时自动修正
 * @returns {{ date: Date }}
 */
function safeDate(year, month, day) {
  const date = new Date(year, month, day);
  // 检查是否溢出（比如 4月31日 → 5月1日）
  if (date.getDate() !== day) {
    // 取当月最后一天
    const capped = new Date(year, month + 1, 0);
    return { date: capped, capped: true, actualDay: capped.getDate() };
  }
  return { date, capped: false };
}

/**
 * 解析中文日期表达式
 * @param {string} text - 输入文本（整条消息或前缀）
 * @returns {{ days: number, label: string } | null}
 */
export function parseDateQuery(text) {
  if (!text) return null;
  const trimmed = text.trim();

  // 1. 固定词：今天/明天/后天/大后天
  const fixedMap = { '今天': 0, '明天': 1, '后天': 2, '大后天': 3 };
  for (const [word, days] of Object.entries(fixedMap)) {
    if (trimmed === word || trimmed.startsWith(word)) {
      return { days, label: word, matchLength: word.length };
    }
  }

  const today = getToday();
  const isoToday = toIsoWeekday(today.getDay());

  // 2. YYYY年M月D日/号（最优先）
  let m = trimmed.match(/^(\d{4})年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)/);
  if (m) {
    const yr = parseInt(m[1]), mo = parseInt(m[2]) - 1, dy = parseInt(m[3]);
    const sd = safeDate(yr, mo, dy);
    const label = sd.capped ? `${m[1]}年${m[2]}月${sd.actualDay}日` : `${m[1]}年${m[2]}月${m[3]}日`;
    return { days: daysFromToday(sd.date), label, matchLength: m[0].length };
  }

  // 3. M月D日/号（无年份）
  m = trimmed.match(/^(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)/);
  if (m) {
    const month = parseInt(m[1]) - 1;
    const day = parseInt(m[2]);
    let sd = safeDate(today.getFullYear(), month, day);
    let label = sd.capped ? `${m[1]}月${sd.actualDay}日` : `${m[1]}月${m[2]}日`;
    // 如果已过，推到明年
    if (sd.date < today) {
      sd = safeDate(today.getFullYear() + 1, month, day);
      if (sd.capped) label = `${m[1]}月${sd.actualDay}日`;
    }
    return { days: daysFromToday(sd.date), label, matchLength: m[0].length };
  }

  // 4. 这个月N号/日
  m = trimmed.match(/^这个月\s*(\d{1,2})\s*(?:日|号)/);
  if (m) {
    const day = parseInt(m[1]);
    const sd = safeDate(today.getFullYear(), today.getMonth(), day);
    const label = sd.capped ? `${today.getMonth() + 1}月${sd.actualDay}日` : `${today.getMonth() + 1}月${day}日`;
    return { days: daysFromToday(sd.date), label, matchLength: m[0].length };
  }

  // 5. 下个月N号/日
  m = trimmed.match(/^下个月\s*(\d{1,2})\s*(?:日|号)/);
  if (m) {
    const day = parseInt(m[1]);
    const sd = safeDate(today.getFullYear(), today.getMonth() + 1, day);
    const label = sd.capped ? `${sd.date.getMonth() + 1}月${sd.actualDay}日` : `${sd.date.getMonth() + 1}月${day}日`;
    return { days: daysFromToday(sd.date), label, matchLength: m[0].length };
  }

  // 6. 下周X / 下星期X
  m = trimmed.match(/^下(?:周|星期)\s*([一二三四五六七日天\d])/);
  if (m) {
    const targetIso = WEEKDAY_CN[m[1]] || WEEKDAY_EN[m[1]];
    if (targetIso) {
      let days = targetIso + 7 - isoToday; // 下周
      const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
      return { days, label: `下周${weekdays[targetIso % 7]}`, matchLength: m[0].length };
    }
  }

  // 7. 这周X / 这星期X / 周X / 星期X
  m = trimmed.match(/^(?:这)?(?:周|星期)\s*([一二三四五六七日天\d])/);
  if (m) {
    const targetIso = WEEKDAY_CN[m[1]] || WEEKDAY_EN[m[1]];
    if (targetIso) {
      let days = targetIso - isoToday;
      if (days < 0) days += 7; // 本周已过，顺延到下周
      const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
      const prefix = days >= 0 && targetIso >= isoToday ? '这' : '下';
      return { days, label: `${prefix}周${weekdays[targetIso % 7]}`, matchLength: m[0].length };
    }
  }

  return null;
}

/**
 * 从消息开头提取日期表达式，用于 router 判断
 * @param {string} text - 完整用户消息
 * @returns {{ days: number, label: string, matchLength: number } | null}
 */
export function extractDateFromPrefix(text) {
  return parseDateQuery(text);
}
