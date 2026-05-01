// server/services/calendar.js — 飞书日历服务
// 读取用户主日历的今日日程，用于 AI 上下文
import fetch from 'node-fetch';
import config from '../config.js';

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';
const TOKEN_URL = `${FEISHU_BASE}/auth/v3/tenant_access_token/internal`;
const CALENDAR_ENDPOINT = `${FEISHU_BASE}/calendar/v4/calendars/primary/events`;

// Token 缓存
let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * 获取 tenant_access_token
 * 内部应用直接使用 app_id + app_secret 换取
 * 缓存 2 小时（飞书默认有效期），到期自动刷新
 */
async function getTenantToken() {
  const now = Date.now();

  // 缓存有效且余量 > 5 分钟
  if (cachedToken && tokenExpiresAt > now + 5 * 60 * 1000) {
    return cachedToken;
  }

  const { appId, appSecret } = config.lark;
  if (!appId || !appSecret) {
    console.warn('[calendar] 飞书 APP_ID 或 APP_SECRET 未配置');
    return null;
  }

  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });

    if (!res.ok) {
      console.error(`[calendar] 获取 token 失败 ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (data.code !== 0) {
      console.error(`[calendar] 获取 token 业务错误: code=${data.code} msg=${data.msg}`);
      return null;
    }

    cachedToken = data.tenant_access_token;
    tokenExpiresAt = now + (data.expire - 60) * 1000; // 提前 1 分钟过期
    console.log('[calendar] tenant_access_token 获取成功');
    return cachedToken;
  } catch (err) {
    console.error('[calendar] 获取 token 异常:', err.message);
    return null;
  }
}

/**
 * 获取今日日历事件
 * @param {Object} [options]
 * @param {number} [options.days=0] - 0=今天, 1=明天, -1=昨天, 也可指定天数
 * @returns {Promise<Array<Object>>} 事件列表，每项 { summary, start, end, isAllDay, description }
 */
export async function getCalendarEvents(options = {}) {
  const { days = 0 } = options;

  // 计算今天 00:00 ~ 23:59 的时间范围（北京时间）
  const now = new Date();
  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + days);
  targetDate.setHours(0, 0, 0, 0);

  const dayStart = new Date(targetDate);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(23, 59, 59, 999);

  const timeMin = toRfc3339(dayStart);
  const timeMax = toRfc3339(dayEnd);

  const token = await getTenantToken();
  if (!token) return [];

  const url = `${CALENDAR_ENDPOINT}?time_min=${encodeURIComponent(timeMin)}&time_max=${encodeURIComponent(timeMax)}&page_size=50`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      console.error(`[calendar] 获取事件失败 ${res.status}`);
      return [];
    }

    const data = await res.json();
    if (data.code !== 0) {
      console.error(`[calendar] 获取事件业务错误: code=${data.code} msg=${data.msg}`);
      return [];
    }

    const items = data.data?.items || [];

    // 过滤已取消的事件，提取有用字段
    const events = items
      .filter(e => e.status !== 'cancelled')
      .map(e => ({
        summary: e.summary || '(无标题)',
        description: e.description || '',
        isAllDay: e.is_all_day || false,
        start: e.start_time?.datetime || e.start_time?.date || '',
        end: e.end_time?.datetime || e.end_time?.date || '',
        location: e.location || '',
        // 保留原始 start_time 对象以便格式化
        startObj: e.start_time,
        endObj: e.end_time,
      }));

    console.log(`[calendar] 获取到 ${events.length} 个今日事件`);
    return events;
  } catch (err) {
    console.error('[calendar] 获取事件异常:', err.message);
    return [];
  }
}

/**
 * 将日程格式化为可读文本（注入 prompt 用）
 * @param {Array} events - 事件列表
 * @returns {string} 格式化后的日程文本
 */
export function formatSchedule(events) {
  if (!events || events.length === 0) {
    return '今日无日程安排';
  }

  // 按开始时间排序
  const sorted = [...events].sort((a, b) => {
    const aTime = a.startObj?.timestamp || 0;
    const bTime = b.startObj?.timestamp || 0;
    return aTime - bTime;
  });

  const lines = [];

  for (const evt of sorted) {
    if (evt.isAllDay) {
      lines.push(`- 【全天】${evt.summary}`);
      continue;
    }

    const timeStr = formatTime(evt.start, evt.end);
    let line = `- ${timeStr} ${evt.summary}`;
    if (evt.location) line += ` (@${evt.location})`;
    if (evt.description) {
      // 只取描述的前 60 个字符，避免 prompt 过胖
      const desc = evt.description.replace(/\n/g, ' ').substring(0, 60);
      line += ` — ${desc}`;
    }
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * 快捷函数：获取今日日程并格式化为文本
 * @param {Object} [options]
 * @returns {Promise<string>} 格式化后的日程文本
 */
export async function getFormattedSchedule(options = {}) {
  const events = await getCalendarEvents(options);
  return formatSchedule(events);
}

/**
 * 获取多天日程（上下文用：今天+明天），方便 AI 有前瞻感知
 * @param {number[]} [dayOffsets=[0,1]] - 天数偏移数组，默认今天+明天
 * @returns {Promise<string>} 格式化后的多日日程
 */
export async function getMultiDaySchedule(dayOffsets = [0, 1]) {
  const results = await Promise.all(
    dayOffsets.map(d => getCalendarEvents({ days: d }).then(events => ({ offset: d, events })))
  );
  const labels = { 0: '今天', 1: '明天', 2: '后天', 3: '大后天' };
  const lines = results.map(({ offset, events }) => {
    return `【${labels[offset] || `第${offset}天`}】\n${formatSchedule(events)}`;
  });
  return lines.join('\n\n');
}

// ============ 辅助函数 ============

/**
 * 将 Date 转为 RFC 3339 格式（北京时间 +08:00）
 * 用本地时间构造，确保日期不因 UTC 偏移漂移
 */
function toRfc3339(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}:${s}+08:00`;
}

/**
 * 从 RFC 3339 字符串中提取时间部分（HH:MM）
 */
function formatTime(startStr, endStr) {
  const toHHMM = (s) => {
    // "2024-01-01T10:30:00+08:00" → "10:30"
    const match = s.match(/T(\d{2}:\d{2})/);
    return match ? match[1] : '';
  };

  const start = toHHMM(startStr);
  const end = toHHMM(endStr);

  if (start && end) return `${start} - ${end}`;
  if (start) return start;
  return '';
}
