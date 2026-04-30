# Treelio — 架构方案 v2

> 个人 AI 私人电台 | 全栈一体 · 长期可维护 · 可部署

---

## 1. 技术栈确认

| 层 | 选型 | 理由 |
|----|------|------|
| **后端** | Node.js + Express + SQLite (sql.js) | 纯 JS 无需 C++ 编译，单文件部署，零配置，备份=复制 |
| **前端** | React + Vite + PWA | 构建快，PWA 支持离线/桌面安装 |
| **AI** | DeepSeek API (deepseek-chat / deepseek-reasoner) | 国内服务，无需代理 |
| **音乐** | NeteaseCloudMusicApi 增强版 (localhost:3000) | 本地代理网易云接口 |
| **样式** | CSS (CSS 变量 + BEM 命名) | 暗色为主，像素风时钟，暖黄 accent |
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
│   ├── config.js             # 读 .env，统一配置导出（安全读取，缺 .env 不崩溃）
│   ├── db/
│   │   └── index.js          # sql.js 初始化 + 迁移
│   ├── api/                  # HTTP API 路由
│   │   ├── chat.js           # POST /api/chat — 对话
│   │   ├── music.js          # GET /api/music/search, /api/music/url, /api/music/lyric
│   │   ├── weather.js        # GET /api/weather — 天气
│   │   └── player.js         # POST /api/player/history, GET /api/player/history — 播放历史
│   ├── services/             # 业务逻辑（不直接处理 HTTP）
│   │   ├── ai.js             # DeepSeek API 调用 + prompt 组装
│   │   ├── netease.js        # 网易云 API 代理封装
│   │   └── weather.js        # 和风天气
│   └── middleware/
│       └── errorHandler.js   # 统一错误处理
│
├── web/                      # ===== 前端 (React + Vite) =====
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx          # React 入口
│       ├── App.jsx           # 根组件
│       ├── components/
│       │   ├── Chat.jsx      # 聊天区域 + 消息气泡
│       │   ├── Player.jsx    # 播放器（进度条、控制按钮、收藏）
│       │   ├── PixelClock.jsx # 像素风时钟
│       │   └── ThemeToggle.jsx # Dark/Light 切换
│       ├── hooks/
│       │   ├── useChat.js    # 对话状态 + API 调用 + localStorage 持久化
│       │   ├── usePlayer.js  # 播放器状态 + 收藏持久化 + 播放记录上报
│       │   └── useTheme.js   # 主题切换
│       ├── styles/
│       │   └── globals.css   # CSS 变量 + 主题 + BEM 样式
│       └── utils/
│           └── api.js        # fetch 封装，统一请求
│
├── data/                     # ===== 数据 =====
│   ├── treelio.db            # SQLite 数据库文件（git ignored）
│   └── user-corpus.json      # 歌单导出（git ignored）
│
└── scripts/                  # ===== 工具脚本 =====
    └── export-netease.js     # 歌单导出（已存在）
```

## 3. 数据库设计 (SQLite / sql.js)

```sql
-- 对话历史
CREATE TABLE IF NOT EXISTS conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT NOT NULL,
  metadata    TEXT,           -- JSON: { songId, mood, weather, ... }
  created_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 用户偏好（品味标签、收听统计）
CREATE TABLE IF NOT EXISTS user_profile (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,  -- JSON
  updated_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 播放历史
CREATE TABLE IF NOT EXISTS play_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id     TEXT NOT NULL,  -- 网易云 song id
  song_name   TEXT,
  artist      TEXT,
  played_at   TEXT DEFAULT (datetime('now', 'localtime'))
);
```

> **表使用状态**：
> - `conversations` — 已使用（AI 对话存储）
> - `user_profile` — 已建表，待接入 Profile 品味标签功能
> - `play_history` — 已使用（播放成功后自动写入）

## 4. 核心 API 设计

### 4.1 对话 `POST /api/chat`

```
请求: { message: "来点放松的" }
响应: {
  reply: "给你挑了几首...",
  songs: [{ id, name, artist, album, coverUrl, duration, url? }],
  mood: "chill"
}
```

流程：
1. 用户消息 → 获取天气上下文
2. 组装 prompt（系统提示 + 天气/时间 + 对话历史）
3. 调用 DeepSeek API → 返回结构化 JSON
4. 如果推荐了歌曲 → 调用网易云获取播放 URL
5. 兜底：AI 提到《歌名》但 songs 为空时自动搜索
6. 返回前端

### 4.2 音乐搜索 `GET /api/music/search?q=xxx&limit=10`

代理到 NeteaseCloudMusicApi `/cloudsearch`，返回搜索结果。

### 4.3 播放 URL `GET /api/music/url?id=xxx`

代理到 NeteaseCloudMusicApi `/song/url`，返回 mp3 链接。

### 4.4 歌词 `GET /api/music/lyric?id=xxx`

代理到 NeteaseCloudMusicApi `/lyric`，返回歌词文本。

### 4.5 天气 `GET /api/weather?location=xxx`

调用和风天气 API，返回当前天气文本（如 "晴 25°C"）。

### 4.6 播放历史 `POST /api/player/history`

```
请求: { songId, songName, artist }
响应: { ok: true }
```

### 4.7 播放历史查询 `GET /api/player/history`

```
响应: { history: [{ id, songId, songName, artist, playedAt }] }
```

## 5. AI Prompt 架构

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

**关键**：不依赖 DeepSeek 的 function calling，用 prompt 约束 JSON 输出格式。后端 parse JSON，如果推荐歌曲则自动获取播放 URL。推荐歌曲必须填入 songs 数组，后端有《歌名》提取兜底。

## 6. 前端设计原则

### 配色（复古电台 + 极简）

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

### 布局

从上到下纵向排列，单栏居中，app 容器 `height: 100vh` + `overflow: hidden`，聊天区内部滚动：

```
┌──────────────────────────────────────┐
│  🎙 TREELIO              [DARK]      │  ← 顶栏
├──────────────────────────────────────┤
│            21:11                     │  ← 像素时钟 (VT323)
│           Monday                     │
│          20 APR 2026                 │
│           ● ON AIR                   │
├──────────────────────────────────────┤
│  ┌─ Player ────────────────────────┐ │
│  │ ≋ If - Bread                    │ │
│  │ PLAYING  |  0:01 ════ 3:26     │ │
│  │ ◄◄  ▌▌  ►►  ♥  🔊             │ │
│  └─────────────────────────────────┘ │
├──────────────────────────────────────┤
│  聊天区（可滚动）                    │
│  ┌─────────────────────────────────┐ │
│  │ Treelio 气泡                    │ │
│  │ 用户气泡                         │ │
│  │ ...                              │ │
│  └─────────────────────────────────┘ │
│  ┌─ Input ─────────────────────────┐ │
│  │ Say something...            ➤  │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```

### 字体

- **VT323** — 像素风时钟显示（Google Fonts）
- **Inter** — 正文（Google Fonts）

## 7. 部署路径

```
开发:  npm run dev          → Vite dev server (5173) + Express (8080)，Vite 代理 /api 到 Express
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

## 8. 依赖清单

### 后端
```
express              # HTTP 框架
sql.js               # SQLite（纯 JS，无需 C++ 编译）
node-fetch           # HTTP 请求（DeepSeek / 天气 / 网易云）
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

## 9. 前端状态持久化

| 数据 | 存储方式 | key |
|------|----------|-----|
| 聊天记录 | localStorage | `treelio-chat-messages` |
| 收藏歌曲 | localStorage | `treelio-liked-songs` |

## 10. MVP 范围（第一期）— 已完成

- [x] 数据准备：歌单语料导出
- [x] 后端骨架：Express + sql.js + DeepSeek 对话
- [x] 网易云代理：搜索 + 获取播放 URL + 歌词
- [x] 前端界面：聊天 + 播放器 + 时钟 + 主题切换
- [x] AI 推荐：根据用户消息推荐歌曲（prompt 强化 + 兜底搜索）
- [x] Dark/Light 主题
- [x] 播放历史记录
- [x] 收藏状态持久化
- [x] 天气 API 路由

### 后续迭代
- 飞书日历集成
- TTS 语音播报（Fish Audio）
- UPnP 推音响
- Profile 品味标签页（user_profile 表待写入）
- 播放历史统计页面
- PWA manifest + Service Worker
- CLI 调用方式（AI 优先用 API）
