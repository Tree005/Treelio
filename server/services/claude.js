// server/services/claude.js — Claude CLI 子进程服务
// spawn Claude CLI 作为 AI 后端，工作在专属文件夹 D:\Tree\Treelio
// 支持 Read/Write/Edit 工具，Claude 可以读写文件夹中的记忆文件
//
// 通信方式：
//   stdin  → 完整的 prompt（system prompt + 用户消息）
//   stdout → Claude 回复的 JSON（--print + --output-format json）
//   stderr → 日志（只读不处理）

import { spawn } from 'child_process';

const CLAUDE_DIR = 'D:\\Tree\\Treelio';

// Windows 上 Claude Code 需要 git-bash 路径
const CLAUDE_CODE_GIT_BASH_PATH = 'D:\\App\\Git-2.53.0\\Git\\usr\\bin\\bash.exe';

/**
 * 调用 Claude CLI 对话
 * @param {string} fullPrompt - 完整的 prompt（system prompt + 用户消息）
 * @param {Object} options - 可选配置
 * @param {number} options.timeout - 超时毫秒（默认 120s）
 * @param {string} options.model - 模型别名（如 'sonnet'），不传则用默认
 * @returns {Promise<Object>} { say, play[] }
 */
export async function askClaude(fullPrompt, options = {}) {
  const { timeout = 120000, model } = options;

  // 构建 claude 启动参数
  const args = [
    '--print',                     // 非交互模式
    '--output-format', 'text',     // 文本输出，由我们解析 JSON
    '--allowedTools', 'Read,Write,Edit,Glob,Grep',  // 文件操作工具
    '--no-session-persistence',    // 不保存会话
  ];

  if (model) {
    args.push('--model', model);
  }

  console.log('[claude] 启动子进程，cwd:', CLAUDE_DIR);
  console.log('[claude] args:', args.join(' '));
  console.log('[claude] prompt 长度:', fullPrompt.length, '字符');

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      reject(new Error(`Claude 子进程超时（${timeout}ms）`));
    }, timeout);

    const proc = spawn('claude', args, {
      cwd: CLAUDE_DIR,
      // 剥离 WorkBuddy 环境变量，否则会干扰 claude 的行为
      env: buildCleanEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      // 不设 shell，直接执行 claude
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timer);

      if (stderr) {
        console.log('[claude-stderr]', stderr.slice(-500));
      }
      console.log('[claude] 退出 code:', code, 'signal:', signal, 'stdout 长度:', stdout.length);

      // 即使 code !== 0 也尝试解析 stdout
      // Claude 有时返回非零但 stdout 有有效 JSON
      const parsed = parseClaudeResponse(stdout);
      if (parsed) {
        resolve(parsed);
      } else if (code !== 0) {
        reject(new Error(`Claude 子进程异常退出 (code: ${code}), stderr: ${stderr.slice(-200)}`));
      } else {
        reject(new Error(`无法解析 Claude 输出: ${stdout.slice(300)}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Claude 子进程启动失败: ${err.message}`));
    });

    // 通过 stdin 发送完整 prompt
    proc.stdin.write(fullPrompt);
    proc.stdin.end();
  });
}

/**
 * 解析 Claude CLI 的输出
 * Claude 返回的是 markdown code block 包裹的 JSON（纯文本模式）
 * 也可能返回纯文本 + JSON 混合
 */
function parseClaudeResponse(stdout) {
  if (!stdout || !stdout.trim()) return null;

  const cleaned = stdout.trim();

  // 0. 从 markdown code block 中提取 JSON
  let jsonText = cleaned;
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1].trim();
  }

  // 1. 提取的 JSON 文本直接解析
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed && typeof parsed === 'object') {
      return normalizeResult(parsed);
    }
  } catch {}

  // 2. 找最后一个完整的 JSON 对象
  let depth = 0, jsonStart = -1, jsonEnd = -1;
  for (let i = jsonText.length - 1; i >= 0; i--) {
    if (jsonText[i] === '}') { if (depth === 0) jsonEnd = i + 1; depth++; }
    else if (jsonText[i] === '{') { depth--; if (depth === 0) jsonStart = i; }
  }
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(jsonText.slice(jsonStart, jsonEnd));
      return normalizeResult(parsed);
    } catch {}
  }

  // 3. 走第三层：如果能解析出非空对象且有 say 字段即可
  try {
    const obj = JSON.parse(jsonText);
    if (obj && typeof obj === 'object' && Object.keys(obj).length > 0) {
      return normalizeResult(obj);
    }
  } catch {}

  return null;
}

/**
 * 规范化 Claude 的输出格式为统一的 {say, play[]}
 */
function normalizeResult(parsed) {
  const say = parsed.say || parsed.response || parsed.text || parsed.message || '';
  const play = parsed.play || parsed.songs || [];

  if (!say && !play.length) {
    // Claude 可能只返回了纯文本，用整段文本作为 say
    const text = JSON.stringify(parsed);
    if (text && text !== '{}') {
      return { say: text.replace(/[{}"]/g, '').trim(), play: [] };
    }
    return null;
  }

  return {
    say: String(say).trim(),
    play: Array.isArray(play) ? play.map(normalizeSong) : [],
  };
}

function normalizeSong(song) {
  if (!song || typeof song !== 'object') return { name: '', artist: '' };
  return {
    id: song.id || '',
    name: song.name || song.title || song.songName || '',
    artist: song.artist || song.ar || '',
  };
}

/**
 * 构建 Claude 的完整 prompt
 * @param {string} systemPrompt - 由 context.js 生成的系统提示
 * @param {string} userMessage - 用户输入
 * @returns {string} 完整 prompt
 */
export function buildClaudePrompt(systemPrompt, userMessage) {
  return `${systemPrompt}

---

用户说：${userMessage}

请严格按照 JSON 格式回复：{"say": "...", "play": [...]}
不推荐歌时 play 填空数组，推荐不超过 3 首。`;
}

/**
 * 构建干净的运行环境，剥离 WorkBuddy 相关环境变量
 * WorkBuddy 的环境变量会拦截 claude 命令并指向其自己的代理
 */
function buildCleanEnv() {
  const cleanEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    // 跳过所有 WorkBuddy/CodeBuddy 相关变量
    if (k.startsWith('CODEBUDDY_') || k.startsWith('ACC_')) continue;
    cleanEnv[k] = v;
  }
  // 设置 git-bash 路径（Windows 需要）
  cleanEnv.CLAUDE_CODE_GIT_BASH_PATH = 'D:\\App\\Git-2.53.0\\Git\\usr\\bin\\bash.exe';
  return cleanEnv;
}
