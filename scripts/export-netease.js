/**
 * NeteaseCloudMusicApi 歌单导出脚本
 *
 * 流程：
 * 1. 通过 MUSIC_U cookie 注入登录
 * 2. 获取用户全部歌单
 * 3. 逐个导出歌单中的歌曲
 * 4. 合并去重后写入 data/user-corpus.json
 *
 * 用法：node scripts/export-netease.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.NETEASE_API_BASE_URL || 'http://localhost:3000';
const OUTPUT_PATH = path.resolve(__dirname, '../data/user-corpus.json');

// 读取 .env 文件（简易解析，不依赖 dotenv）
function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}
loadEnv();

// ============ 工具函数 ============

function request(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(`${API_BASE}${url}`);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 3000,
      path: urlObj.pathname + urlObj.search,
      headers: {},
    };
    // 如果有 MUSIC_U，附加 cookie
    if (process.env.MUSIC_U) {
      options.headers.Cookie = `MUSIC_U=${process.env.MUSIC_U}`;
    }
    http.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON 解析失败: ${data.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ Cookie 验证 ============

async function verifyLogin() {
  console.log('🔐 正在验证 Cookie...');
  const accountRes = await request(`/user/account?timestamp=${Date.now()}`);
  if (accountRes.code === 200 && accountRes.account) {
    console.log(`✅ Cookie 有效！用户: ${accountRes.profile?.nickname || '未知'}\n`);
    return accountRes;
  }
  throw new Error(`Cookie 无效或已过期: ${JSON.stringify(accountRes)}`);
}

// ============ 歌单导出 ============

async function getUserPlaylists(uid) {
  let allPlaylists = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    console.log(`   获取歌单列表... (${allPlaylists.length}+)`);
    const res = await request(
      `/user/playlist?uid=${uid}&limit=${limit}&offset=${offset}&timestamp=` + Date.now()
    );

    if (res.code !== 200 || !res.playlist || res.playlist.length === 0) {
      break;
    }

    allPlaylists = allPlaylists.concat(res.playlist);
    offset += limit;

    if (res.playlist.length < limit) break;
  }

  return allPlaylists;
}

async function getPlaylistTracks(id, totalTracks) {
  // 用 /playlist/track/all 替代 /playlist/detail（增强版 API detail 不返回歌曲）
  const limit = 200;
  let allTracks = [];
  let offset = 0;

  while (offset < totalTracks) {
    const res = await request(
      `/playlist/track/all?id=${id}&limit=${limit}&offset=${offset}&timestamp=` + Date.now()
    );
    if (res.code !== 200 || !res.songs || res.songs.length === 0) {
      break;
    }
    allTracks = allTracks.concat(res.songs);
    offset += limit;
    // 避免请求过快
    await sleep(300);
  }

  return allTracks;
}

function normalizeTrack(track, playlistName) {
  if (!track || !track.id) return null;

  return {
    name: track.name || '未知',
    artist: (track.ar || track.artists || [])
      .map((a) => a.name)
      .join(' / '),
    album: track.al ? track.al.name : track.album ? track.album.name : '',
    genre: [],
    durationMs: track.dt || track.duration || 0,
    platformId: String(track.id),
    platform: 'netease',
    sourcePlaylist: playlistName,
  };
}

// ============ 主流程 ============

async function main() {
  console.log('='.repeat(50));
  console.log('  网易云音乐歌单导出工具 (Cookie 模式)');
  console.log('='.repeat(50));

  // 从 .env 读取 MUSIC_U，或从环境变量
  const MUSIC_U = process.env.MUSIC_U;
  if (!MUSIC_U) {
    console.error('\n❌ 未找到 MUSIC_U cookie');
    console.error('   请设置环境变量: set MUSIC_U=你的值');
    console.error('   或在 .env 文件中添加: MUSIC_U=你的值');
    process.exit(1);
  }

  // 检查 API 是否可用
  try {
    await request('/search?keywords=test&limit=1');
  } catch (e) {
    console.error('\n❌ 无法连接 NeteaseCloudMusicApi');
    console.error(`   请确保服务已启动: ${API_BASE}`);
    process.exit(1);
  }

  // 1. 验证 Cookie
  const loginRes = await verifyLogin();

  // 2. 获取用户信息（复用登录验证结果）
  const account = loginRes;
  const uid = account.account?.id;
  if (!uid) {
    throw new Error('无法获取用户 ID，登录可能未成功');
  }
  console.log(`   用户: ${account.profile?.nickname || uid}\n`);

  // 3. 获取全部歌单
  console.log('📂 获取全部歌单...');
  const playlists = await getUserPlaylists(uid);
  console.log(`   共 ${playlists.length} 个歌单\n`);

  const allSongs = new Map();

  // 4. 逐个导出歌曲
  for (let i = 0; i < playlists.length; i++) {
    const pl = playlists[i];
    const trackCount = pl.trackCount || 0;
    console.log(
      `   [${i + 1}/${playlists.length}] ${pl.name} (${trackCount} 首)`
    );

    if (trackCount === 0) continue;

    try {
      const tracks = await getPlaylistTracks(pl.id, trackCount);
      for (const track of tracks) {
        const song = normalizeTrack(track, pl.name);
        if (song && !allSongs.has(song.platformId)) {
          allSongs.set(song.platformId, song);
        }
      }
      console.log(`       ✅ 获取 ${tracks.length} 首\n`);
    } catch (e) {
      console.warn(`       ⚠️ 失败: ${e.message}\n`);
    }

    // 避免请求过快
    await sleep(500);
  }

  // 5. 组装输出
  const corpus = {
    version: 1,
    exportedAt: new Date().toISOString(),
    user: {
      uid: String(uid),
      nickname: account.profile?.nickname || '',
    },
    stats: {
      totalSongs: allSongs.size,
      totalPlaylists: playlists.length,
    },
    platforms: {
      netease: {
        exportedAt: new Date().toISOString(),
        songs: Array.from(allSongs.values()),
      },
    },
  };

  // 6. 写入文件
  const outputDir = path.dirname(OUTPUT_PATH);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(corpus, null, 2), 'utf-8');

  console.log('='.repeat(50));
  console.log('  导出完成！');
  console.log('='.repeat(50));
  console.log(`   总歌曲数: ${allSongs.size}`);
  console.log(`   歌单数: ${playlists.length}`);
  console.log(`   输出文件: ${OUTPUT_PATH}`);
  console.log(`   文件大小: ${(fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1)} KB`);
  console.log('');
}

main().catch((err) => {
  console.error(`\n❌ 错误: ${err.message}`);
  process.exit(1);
});
