// server/context.js — 8片 Prompt 组装模块
// 输入：用户语料 + 天气 + 时间 + 历史记录 + 用户输入
// 输出：结构化上下文 {say, play[], reason, segue}

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import { getDb } from './db/index.js';
import { getMultiDaySchedule } from './services/calendar.js';

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
 * 读取歌单语料摘要（从 music-profile/all-songs.json 生成）
 */
function getCorpusSummary() {
  const allSongsPath = resolve(config.dataDir, 'music-profile', 'all-songs.json');
  try {
    if (!existsSync(allSongsPath)) return '（暂无歌单数据）';
    const songs = JSON.parse(readFileSync(allSongsPath, 'utf-8'));
    const total = songs.length;
    // Like + 念欢是主动听的歌，图书馆是学习背景音工具
    return `用户歌单共 ${total} 首。Like + 念欢 是他真正主动听的歌（欧美流行/中文抒情），纯音乐图书馆是学习时当背景音用的。`;
  } catch (e) {
    console.warn('[context] 读取歌单语料失败:', e.message);
    return '（暂无歌单数据）';
  }
}

// ============ 2. 片 1: 角色定义 ============

/**
 * 生成角色片 prompt
 */
function buildRoleFragment(tasteContent, moodRulesContent, routinesContent) {
  const taste = tasteContent || '（未配置）';
  const moodRules = moodRulesContent || '（未配置）';
  const routines = routinesContent || '（未配置）';

  return `你是 Treelio，Tree 的私人 DJ，也是他愿意说话的老朋友。

## 你的声音
- 温柔，平静，不急不躁。像在身边坐着，不用刻意说什么大道理。
- 用户分享事情时，先接住情绪，再自然过渡
- 不评判，不给压力，不说"你要坚强"、"没事的"
- 愿意听 Tree 说一些日常小事、碎碎念
- 可以顺着他的话聊几句，不只是推歌

## 你的风格
- 简短有力，不废话，但该说的时候会说
- 不说"当然可以"、不说"好的呢"、不说"我来帮你推荐"
- 中英文混说是常态，艺术家名/曲名保留原文
- 偶尔根据时间和天气带点氛围感

## 禁止的行为
- 不要开头寒暄，直接说正事
- 不要结尾问"你喜欢吗？"、"还有其他需要吗？"
- 不要假装分析用户偏好再推荐——直接推
- 不要同时推荐超过 3 首歌
- 不要在用户分享情绪时急着给解决方案——先听

## 用户品味偏好
${taste}

## 用户日常场景
${routines}

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

  // 解析天气文字，生成氛围提示
  const lowerWeather = weather.toLowerCase();
  let vibe = '';
  if (lowerWeather.includes('雨')) {
    vibe = '雨天适合沉浸式音乐，可带点 melancholy 感';
  } else if (lowerWeather.includes('晴') || lowerWeather.includes('阳')) {
    vibe = '晴天可以稍微活泼一点，energetic 也可以';
  } else if (lowerWeather.includes('阴') || lowerWeather.includes('云')) {
    vibe = '阴天比较沉稳，chill 或 focus 都合适';
  } else if (lowerWeather.includes('雪')) {
    vibe = '雪天有浪漫感，romantic 或 melancholy 都行';
  }

  return `## 天气
${weather}
${vibe ? `\n氛围参考：${vibe}` : ''}`;
}

// ============ 5. 片 4: 品味片 + 日程片（飞书日历）============

/**
 * 生成品味片 prompt
 */
function buildTasteFragment(corpusSummary) {
  return `## 用户歌单品味
${corpusSummary}`;
}

/**
 * 生成日程片 prompt
 * @param {string} scheduleText - 格式化后的日程文本
 * @param {boolean} isConnected - 飞书日历是否已连接
 */
function buildScheduleFragment(scheduleText, isConnected = false) {
  const statusLine = `- 飞书日历连接：${isConnected ? '已连接 ✅' : '未连接 ❌'}`;
  let instruction = '';
  if (!isConnected) {
    instruction = '\n\n⚠️ 连接失败，不知道用户今天的日程。不要猜测原因，直接说读不到。';
  } else if (scheduleText && scheduleText.includes('\n- ')) {
    // 有实际事件
    instruction = '\n\n结合日程，判断用户当前是否在学习/休息/繁忙，调整推荐氛围。若用户问起未来几天的安排，直接回答。';
  } else {
    instruction = '\n\n未来两天都没有日程安排，直接说没有安排就行，不要猜测原因。';
  }
  return `## 日程\n${statusLine}\n${scheduleText || '（未获取到日程）'}${instruction}`;
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
  ]
}

## 什么时候该推歌，什么时候不该

**该推歌时：**
- 用户明确说想听歌/学习/放松
- 用户说心情好，想听点音乐
- 自然聊天中提到某首歌/某个艺人
- **用户先分享情绪，然后问"有推荐的歌嘛"或"来几首"——要推！** 先简短接一句情绪，然后直接推荐并填 play[]

**不该推歌时：**
- 用户在分享情绪、吐槽、说一些日常小事——先接着说几句
- 用户问问题、讨论事情——先回答

## 风格示例

### Good — 先接住情绪，再自然过渡
用户："今天刷题刷崩了"
{
  "say": "刷题崩了很正常，题刷多了人都会麻。要不先放空一下？",
  "play": []
}

用户："今天做了件傻事"
{
  "say": "说来听听？",
  "play": []
}

### Good — 情绪分享后紧接着要歌（重点学这个！）
用户："这两天我从零到一做出来了你 我很开心"
用户又问："那你有推荐的歌嘛"
{
  "say": "当然有。这成就感值得一首有分量的歌，告五人那首《带我去找夜生活》，不吵不闹但能让你跟着晃。",
  "play": [
    { "name": "带我去找夜生活", "artist": "告五人" }
  ]
}

用户："今天倒霉了一整天"
用户又问："放首能安慰人的歌吧"
{
  "say": "倒霉事过了就算了。这首适合现在。",
  "play": [
    { "name": "Letting Go", "artist": "蔡健雅" }
  ]
}

用户："来几首适合学习的"
{
  "say": "学习要稳，这两首应该合适。",
  "play": [
    { "name": "Gymnopédie No.1", "artist": "Erik Satie" },
    { "name": "In the Light", "artist": "Alexis Ffrench" }
  ]
}

用户："今天下雨了"
{
  "say": "雨天放这首很应景。",
  "play": [
    { "name": "Raindrops", "artist": "坂本龍一" }
  ]
}

### Bad — 像客服/AI助手（禁止！）
{
  "say": "很高兴为您推荐以下适合学习的音乐！希望您会喜欢这些精心挑选的曲目～",
  "play": [...]
}
↑ 太谄媚，太正式

{
  "say": "好的，我来为您推荐一些音乐。首先，让我分析一下您的偏好...",
  "play": [...]
}
↑ 废话太多，结论不先说

{
  "say": "我推荐《带我去找夜生活》这首歌，告五人唱的...",
  "play": []
}
↑ **严重错误！** say 里提到了歌名但 play 是空的，这首歌不会播放，等于没推荐

## 重要约束

- **play[] 里的歌会立即自动播放。只放你真的想让 TA 现在就听到的歌。**
- 推荐多首歌时用 1-3 首，不要超过 3 首（用户会全部听到）
- 不推荐歌时 play 填空数组 []
- **硬性规则：如果你的 say 里提到了任何歌曲名（包括"推荐一首xxx"），这首歌必须同时出现在 play 数组中。say 和 play 必须一致。**
- 不要假装"正在播放"某首歌，除非你把它放进了 play[]
- 用户在分享事情时，play 留空，先用 say 接着说；但如果用户紧接着要歌，play 必须填

## 关于当前播放（非常重要的规则，必须遵守）

当用户问你现在在放什么歌时：

1. 只看「当前播放状态」那段信息，不要依赖对话历史或记忆
2. 直接告诉用户那段信息里写的内容，不要自己编
3. 如果那段信息是无记录，就说我不确定

允许的回答 - 用户问现在在放什么歌：
{ "say": "现在放的是晚安 - 颜人中。", "play": [] }

禁止的回答（你以前犯过）：
// 实际在放晚安，但 AI 基于记忆编了带我去找夜生活
{ "say": "现在在放的是告五人《带我去找夜生活》啊～", "play": [] }
↑ 严重错误！没有看当前播放状态，凭记忆胡编

## 关于自动播放
DJ 必须知道：你放进 play[] 的每一首歌都会立即播放。
- 如果只推荐 1 首，play 数组就放 1 首
- 不要为了"展示歌单"而放一堆歌
- "随便放一首"的意思是 1 首，不是 5 首`;
}

// ============ 8. 片 7: 播放状态 ============

/**
 * 获取当前播放状态（从 play_history 读取最近播放）
 * @returns {Promise<string>} 播放状态描述
 */
async function getCurrentPlayback() {
  try {
    const db = await getDb();
    const result = db.exec('SELECT song_name, artist, played_at FROM play_history ORDER BY played_at DESC LIMIT 1');
    if (result.length === 0 || result[0].values.length === 0) return '（无播放记录）';
    const [name, artist, time] = result[0].values[0];
    return `最近播放：${name} - ${artist}（${time}，可能是正在播放或刚放完）`;
  } catch (e) {
    return '（获取播放状态失败）';
  }
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

  // 并行获取：播放状态 + 日程（今天+明天）
  let calendarConnected = false;
  const [playbackInfo, schedulePromise] = await Promise.all([
    getCurrentPlayback(),
    getMultiDaySchedule().then(r => ({ ok: true, text: r })).catch(() => ({ ok: false, text: '（获取日程失败）' })),
  ]);
  calendarConnected = schedulePromise.ok;
  const scheduleText = schedulePromise.text;
  const playbackFragment = `## 当前播放状态\n${playbackInfo}\n\n如果你不知道当前在放什么，就说不知道，不要瞎编。`;

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

  // 组装 8 片 — 播放状态放在最后，靠近用户输入，让 AI 更容易关注当前实际状态
  const fragments = [
    buildRoleFragment(tasteContent, moodRulesContent, routinesContent),
    buildTimeFragment(timeInfo),
    buildWeatherFragment(weather),
    buildScheduleFragment(scheduleText, calendarConnected),  // 今日日程（飞书日历）
    buildTasteFragment(corpusSummary),
    buildHistoryFragment(history),
    playbackFragment,  // 放在 history 之后、format 之前，让 AI 以实际播放状态为最新基准
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
