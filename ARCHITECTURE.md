# Treelio — 架构方案 v1

> 个人 AI 私人电台 | 全栈一体 · 长期可维护 · 可部署

---

## 1. 技术栈确认

| 层 | 选型 | 理由 |
|----|------|------|
| **后端** | Node.js + Express + SQLite (better-sqlite3) | 单文件部署，零配置，备份=复制 |
| **前端** | React + Vite + PWA | 构建快，PWA 支持离线/桌面安装 |
| **AI** | DeepSeek API (deepseek-chat / deepseek-reasoner) | 国内服务，无需代理 |
| **音乐** | NeteaseCloudMusicApi 增强版 (localhost:3000) | 本地代理网易云接口 |
| **样式** | CSS Modules / Tailwind | 暗色为主，像素风时钟，无渐变紫 |
| **部署** | npm run build → 单进程部署 | 前端打包为静态文件，后端 serve |

## 2. 项目结构

```
treelio/
├── package.json              # 统一依赖管理
├── .env                      # 密钥（不进 git）
├── .gitignore
├── CLAUDE.md                 # AI 行为规范
│
├── server/                   # ===== 后端 =====
│   ├── index.js              # Express 入口，启动 HTTP 服务
│   ├── config.js             # 读 .env，统一配置导出
│   ├── db/
│   │   ├── index.js          # better-sqlite3 初始化
│   │   ├── migrations/       # 数据库迁移脚本
│   │   └── seed.js           # 初始数据填充
│   ├── api/                  # HTTP API 路由
│   │   ├── chat.js           # POST /api/chat — 对话
│   │   ├── music.js          # GET /api/music/search, /api/music/url, /api/music/lyric
│   │   ├── player.js         # GET/POST /api/player — 播放状态
│   │   └── weather.js        # GET /api/weather — 天气
│   ├── services/             # 业务逻辑（不直接处理 HTTP）
│   │   ├── ai.js             # DeepSeek API 调用 + prompt 组装
│   │   ├── netease.js        # 网易云 API 代理封装
│   │   ├── weather.js        # 和风天气
│   │   └── memory.js         # 对话历史 / 用户偏好读写
│   └── middleware/
│       └── errorHandler.js   # 统一错误处理
│
├── web/                      # ===== 前端 (React + Vite + PWA) =====
│   ├── index.html
│   ├── vite.config.js
│   ├── public/
│   │   ├── manifest.json     # PWA manifest
│   │   └── sw.js             # Service Worker
│   └── src/
│       ├── main.jsx          # React 入口
│       ├── App.jsx           # 根组件，路由 + 布局
│       ├── components/
│       │   ├── Chat/         # 聊天区域
│       │   │   ├── ChatPanel.jsx
│       │   │   ├── MessageBubble.jsx
│       │   │   └── ChatInput.jsx
│       │   ├── Player/       # 播放器
│       │   │   ├── PlayerBar.jsx
│       │   │   ├── ProgressBar.jsx
│       │   │   └── Controls.jsx
│       │   ├── Clock/        # 像素风时钟
│       │   │   └── PixelClock.jsx
│       │   └── ThemeToggle/  # Dark/Light 切换
│       │       └── ThemeToggle.jsx
│       ├── hooks/
│       │   ├── useChat.js    # 对话状态 + API 调用
│       │   ├── usePlayer.js  # 播放器状态
│       │   └── useTheme.js   # 主题切换
│       ├── styles/
│       │   ├── globals.css   # CSS 变量 / 基础样式
│       │   ├── theme.css     # Dark/Light 主题定义
│       │   └── clock.css     # 像素风时钟专用样式
│       └── utils/
│           └── api.js        # fetch 封装，统一请求
│
├── data/                     # ===== 数据 =====
│   ├── treelio.db           # SQLite 数据库文件（git ignored）
│   └── user-corpus.json      # 歌单导出（已存在）
│
└── scripts/                  # ===== 工具脚本 =====
    └── export-netease.js     # 歌单导出（已存在）
```

## 3. 数据库设计 (SQLite)

```sql
-- 对话历史
CREATE TABLE conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT NOT NULL,
  metadata    TEXT,           -- JSON: { songId, mood, weather, ... }
  created_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 用户偏好（品味标签、收听统计）
CREATE TABLE user_profile (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,  -- JSON
  updated_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 播放历史
CREATE TABLE play_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id     TEXT NOT NULL,  -- 网易云 song id
  song_name   TEXT,
  artist      TEXT,
  played_at   TEXT DEFAULT (datetime('now', 'localtime'))
);
```

## 4. 核心 API 设计

### 4.1 对话 `POST /api/chat`

```
请求: { message: "来点放松的", context: { weather, time, mood? } }
响应: {
  reply: "给你挑了几首...",
  songs: [{ id, name, artist, album, coverUrl, duration }],
  mood: "chill",
  narration: "下午三点，阳光正好..."   // 可选 DJ 播报文本
}
```

流程：
1. 用户消息 → 组装 prompt（系统提示 + 天气/时间上下文 + 对话历史 + 用户品味）
2. 调用 DeepSeek API → 返回结构化 JSON
3. 如果推荐了歌曲 → 调用网易云获取播放 URL
4. 存对话历史到 SQLite
5. 返回前端

### 4.2 音乐 `GET /api/music/search?q=xxx`

代理到 NeteaseCloudMusicApi `/cloudsearch`，返回搜索结果。

### 4.3 播放 `GET /api/music/url?id=xxx`

代理到 NeteaseCloudMusicApi `/song/url`，返回 mp3 链接。

### 4.4 天气 `GET /api/weather?location=xxx`

调用和风天气 API，返回当前天气。

## 5. AI Prompt 架构

从截图中的 6 片 prompt 结构，简化为 MVP 版：

```
System Prompt 组装顺序：
┌─────────────────────────────────────┐
│ 1. 角色定义                         │
│    "你是 Treelio，一个私人 DJ..."    │
├─────────────────────────────────────┤
│ 2. 外部上下文                       │
│    时间：{now}                      │
│    天气：{weather}                  │
│    日程：{schedule}（后续）          │
├─────────────────────────────────────┤
│ 3. 用户品味                         │
│    从 user-corpus.json 或 profile    │
│    提取的品味标签和偏好              │
├─────────────────────────────────────┤
│ 4. 对话历史（最近 20 轮）           │
│    从 SQLite conversations 表读取    │
├─────────────────────────────────────┤
│ 5. 工具说明                         │
│    你可以搜索音乐、获取天气...       │
│    返回 JSON 格式的指令              │
├─────────────────────────────────────┤
│ 6. 输出格式约束                     │
│    必须返回 JSON：                   │
│    { reply, songs?, action? }       │
└─────────────────────────────────────┘
```

**关键**：不依赖 DeepSeek 的 function calling，用 prompt 约束 JSON 输出格式。后端 parse JSON，如果推荐歌曲则自动获取播放 URL。

## 6. 前端设计原则

### 配色（无渐变紫，去 AI 味）

```
Dark Mode:
  --bg:        #0a0a0a        深黑背景
  --surface:   #141414        卡片/面板
  --text:      #e8e8e8        主文本
  --text-dim:  #666666        次要文本
  --accent:    #e8c547        暖黄高亮（像老式电台指示灯）
  --red:       #c94040        播放/收藏红
  --border:    #222222        分隔线

Light Mode:
  --bg:        #f5f0e8        暖米白（纸张感）
  --surface:   #ffffff
  --text:      #1a1a1a
  --text-dim:  #888888
  --accent:    #c4960c        琥珀黄
  --border:    #e0d8c8
```

核心调性：**复古电台 + 极简**，不是科技感，是温暖感。

### 布局（对应截图）

从上到下纵向排列，单栏居中布局，电台感强烈：

```
┌──────────────────────────────────────┐
│  🎙 TREELIO              [DARK]      │  ← 顶栏：Logo + 主题切换
├──────────────────────────────────────┤
│                                      │
│            21:11                     │  ← 像素时钟（居中，超大）
│           Monday                     │
│          20 APR 2026                 │
│           ● ON AIR                   │  ← 绿色指示灯
│                                      │
├──────────────────────────────────────┤
│  ┌─ Player ────────────────────────┐ │
│  │ ≋ If - Bread                    │ │  ← 波形/封面 + 歌名
│  │ PLAYING                         │  ← 播放状态文字
│  │ 0:01 ════════════ 3:26         │  ← 进度条
│  │ ◄◄  ▌▌  ►►  ♥  🔊             │ │  ← 控制按钮
│  └─────────────────────────────────┘ │
├──────────────────────────────────────┤
│  ● Treelio                      LIVE │  ← 聊天区标题
│  Connected to Treelio server         │
│                                      │
│  ┌─ Treelio 头像 ──────────────────┐ │
│  │ 这是 Treelio，深夜了...         │ │  ← DJ 播报气泡
│  └─────────────────────────────────┘ │
│  21:02  ▶ REPLAY                     │
│                                      │
│  Now playing: If - Bread             │  ← 播放提示
│                                      │
│  ┌─ 用户头像 ──────────────────────┐ │
│  │ 好听                            │ │  ← 用户消息
│  └─────────────────────────────────┘ │
│                                      │
│  ┌─ Input ─────────────────────────┐ │
│  │ Say something...          🎤  ➤ │ │  ← 输入框 + 语音(后续) + 发送
│  └─────────────────────────────────┘ │
├──────────────────────────────────────┤
│  TREELIO FM              CONNECTED   │  ← 底栏
└──────────────────────────────────────┘
```

**关键细节**：
- 时钟居中，非顶栏；日期/星期/ON AIR 指示灯在时钟下方
- 播放器显示波形动画、进度条、完整控制
- 聊天消息带头像气泡（Treelio 用自定义头像，用户用默认头像）
- 用户头像文件：`data/耳机头.jpg`
- MVP 不做 QUEUE 播放队列，只做"当前播放 + 聊天"
- 输入框预留语音按钮位置（后续 Fish Audio TTS）

### 像素时钟

用 CSS 或 SVG 实现，不需要图片。字体可用 Google Fonts 的 "Press Start 2P" 或 "VT323"。

## 7. 部署路径

```
开发:  npm run dev          → Vite dev server (3001) + Express (8080)，Vite 代理 /api 到 Express
构建:  npm run build        → Vite 打包到 server/public/
生产:  npm run start        → 单个 Node 进程，Express serve 静态文件 + API
```

后续买服务器：
1. 服务器装 Node.js
2. `git clone` + `npm install`
3. 同步 SQLite 数据库文件（`data/treelio.db`）
4. NeteaseCloudMusicApi 也部署到同一台机器
5. PM2 守护进程，Nginx 反代 HTTPS
6. PWA 支持直接添加到手机桌面

## 8. MVP 范围（第一期）

### 做什么
- [x] 数据准备：歌单语料导出（已完成）
- [ ] 后端骨架：Express + SQLite + DeepSeek 对话
- [ ] 网易云代理：搜索 + 获取播放 URL
- [ ] 前端界面：聊天 + 播放器 + 时钟
- [ ] AI 推荐：根据用户消息推荐歌曲
- [ ] Dark/Light 主题

### 不做（后续迭代）
- 飞书日历集成
- TTS 语音播报（Fish Audio）
- UPnP 推音响
- Profile 品味标签页
- 播放历史统计
- CLI 调用方式（AI 优先用 API）

## 9. 依赖清单

### 后端
```
express              # HTTP 框架
better-sqlite3       # SQLite（同步 API，简单可靠）
dotenv               # .env 解析
node-fetch           # HTTP 请求（DeepSeek / 天气）
cors                 # 跨域（开发时用）
```

### 前端
```
react, react-dom     # UI 框架
vite                 # 构建工具
@vitejs/plugin-react # Vite React 插件
```

### 开发工具
```
concurrently         # 同时跑前后端
```

---

## 10. 启动命令（最终）

```bash
# 开发（前后端同时启动）
npm run dev

# 构建（前端打包到 server/public）
npm run build

# 生产启动
npm run start
```
