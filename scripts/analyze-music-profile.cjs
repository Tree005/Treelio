/**
 * 音乐画像分析脚本
 * 
 * 功能：
 * 1. 完整导出全部歌单（保留多歌单归属关系）
 * 2. 获取听歌排行（周榜/总榜）
 * 3. 获取最近播放记录
 * 4. 生成听歌画像报告
 * 
 * 用法：node scripts/analyze-music-profile.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.NETEASE_API_BASE_URL || 'http://localhost:3000';
const OUTPUT_DIR = path.resolve(__dirname, '../data/music-profile');

// 读取 .env
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
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

// HTTP 请求
function request(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(`${API_BASE}${url}`);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 3000,
      path: urlObj.pathname + urlObj.search,
      headers: process.env.MUSIC_U ? { Cookie: `MUSIC_U=${process.env.MUSIC_U}` } : {},
    };
    http.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) {
          reject(new Error(`JSON 解析失败: ${data.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ 1. 完整导出歌单（支持多歌单归属）============

async function getAllPlaylistTracks(playlist) {
  const limit = 200;
  let allTracks = [];
  let offset = 0;
  
  while (offset < playlist.trackCount) {
    const res = await request(
      `/playlist/track/all?id=${playlist.id}&limit=${limit}&offset=${offset}&timestamp=` + Date.now()
    );
    if (res.code !== 200 || !res.songs || res.songs.length === 0) break;
    allTracks = allTracks.concat(res.songs.map(s => ({ ...s, _sourcePlaylist: playlist.name })));
    offset += limit;
    if (res.songs.length < limit) break;
    await sleep(200);
  }
  
  return allTracks;
}

async function exportAllPlaylists(uid) {
  console.log('📂 获取全部歌单...');
  const plRes = await request(`/user/playlist?uid=${uid}&limit=100&timestamp=` + Date.now());
  const playlists = plRes.playlist || [];
  console.log(`   共 ${playlists.length} 个歌单\n`);

  // 用 Map 存储，value 包含 song 信息和 sourcePlaylists 数组
  const allSongs = new Map();
  const playlistStats = [];

  for (const pl of playlists) {
    console.log(`   [${pl.name}] ${pl.trackCount} 首...`);
    if (pl.trackCount === 0) continue;

    try {
      const tracks = await getAllPlaylistTracks(pl);
      let newCount = 0, dupCount = 0;

      for (const track of tracks) {
        if (!track.id) continue;
        const pid = String(track.id);
        
        if (allSongs.has(pid)) {
          // 已存在：追加歌单来源
          const existing = allSongs.get(pid);
          if (!existing.sourcePlaylists.includes(pl.name)) {
            existing.sourcePlaylists.push(pl.name);
          }
          dupCount++;
        } else {
          // 新歌曲
          allSongs.set(pid, {
            platformId: pid,
            name: track.name || '未知',
            artist: (track.ar || track.artists || []).map(a => a.name).join(' / '),
            album: track.al?.name || track.album?.name || '',
            durationMs: track.dt || track.duration || 0,
            platform: 'netease',
            sourcePlaylists: [pl.name], // 用数组存储所有来源歌单
          });
          newCount++;
        }
      }

      playlistStats.push({ name: pl.name, total: tracks.length, newCount, dupCount });
      console.log(`      ✅ 新增:${newCount} 重复:${dupCount}`);
    } catch (e) {
      console.warn(`      ⚠️ 失败: ${e.message}`);
    }

    await sleep(300);
  }

  return { allSongs: Array.from(allSongs.values()), playlistStats, playlists };
}

// ============ 2. 获取听歌排行 ============

async function getPlayRecords(uid) {
  console.log('\n📊 获取听歌排行...');
  
  // type: 0 = 周榜, 1 = 总榜
  const weekRes = await request(`/user/record?uid=${uid}&type=0&timestamp=` + Date.now());
  const allTimeRes = await request(`/user/record?uid=${uid}&type=1&timestamp=` + Date.now());
  
  const weekRecords = (weekRes.code === 200 ? weekRes.weekData || [] : []).map(r => ({
    name: r.song?.name,
    artist: r.song?.ar?.map(a => a.name).join(' / '),
    playCount: r.playCount,
    id: String(r.song?.id),
  }));
  
  // type=1 总榜实际数据也在 weekData（同接口不同 type，allData 通常为空）
  const allTimeRecords = (allTimeRes.code === 200 ? allTimeRes.weekData || [] : []).map(r => ({
    name: r.song?.name,
    artist: r.song?.ar?.map(a => a.name).join(' / '),
    playCount: r.playCount,
    id: String(r.song?.id),
  }));
  
  console.log(`   周榜: ${weekRecords.length} 首`);
  console.log(`   总榜: ${allTimeRecords.length} 首`);
  
  return { weekRecords, allTimeRecords };
}

// ============ 3. 获取最近播放 ============

async function getRecentPlays() {
  console.log('\n🕐 获取最近播放...');
  const res = await request(`/record/recent/song?limit=100&timestamp=` + Date.now());
  
  if (res.code !== 200) {
    console.log('   ⚠️ 最近播放接口未返回有效数据');
    return [];
  }
  
  const songs = (res.data?.list || []).map(item => ({
    name: item.data?.name,
    artist: item.data?.ar?.map(a => a.name).join(' / '),
    playTime: new Date(item.playTime || item.data?.playTime || Date.now()).toISOString(),
    id: String(item.data?.id),
  }));
  
  console.log(`   最近播放: ${songs.length} 首`);
  return songs;
}

// ============ 4. 统计与分析 ============

function analyzeProfile(songs, weekRecords, allTimeRecords, recentPlays, playlists) {
  console.log('\n📈 生成听歌画像...');

  // 风格统计（基于艺术家）
  const artistCount = {};
  songs.forEach(s => {
    const artist = s.artist || '未知';
    artistCount[artist] = (artistCount[artist] || 0) + 1;
  });

  // 歌单统计
  const playlistCount = {};
  songs.forEach(s => {
    (s.sourcePlaylists || []).forEach(pl => {
      playlistCount[pl] = (playlistCount[pl] || 0) + 1;
    });
  });

  // 时长统计
  const totalDurationMs = songs.reduce((sum, s) => sum + (s.durationMs || 0), 0);
  const totalMinutes = Math.round(totalDurationMs / 60000);

  // 播放次数最多的歌曲（从总榜）
  const topPlayed = allTimeRecords.slice(0, 20);

  // 最近播放的艺术家
  const recentArtistCount = {};
  recentPlays.forEach(s => {
    const artist = s.artist || '未知';
    recentArtistCount[artist] = (recentArtistCount[artist] || 0) + 1;
  });

  return {
    summary: {
      totalSongs: songs.length,
      totalPlaylists: playlists.length,
      totalDurationMinutes: totalMinutes,
      totalDurationReadable: `${Math.floor(totalMinutes / 60)} 小时 ${totalMinutes % 60} 分钟`,
    },
    topArtists: Object.entries(artistCount).sort((a, b) => b[1] - a[1]).slice(0, 20),
    playlistDistribution: Object.entries(playlistCount).sort((a, b) => b[1] - a[1]),
    topPlayed,
    recentPlays: recentPlays.slice(0, 20),
    recentTopArtists: Object.entries(recentArtistCount).sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
}

// ============ 5. 生成报告 ============

function generateReport(profile, playlists, playlistStats) {
  const lines = [];
  
  lines.push('# 听歌画像报告');
  lines.push(`生成时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`);
  
  lines.push('## 基本数据');
  lines.push(`- 去重歌曲总数: **${profile.summary.totalSongs}** 首`);
  lines.push(`- 歌单总数: **${profile.summary.totalPlaylists}** 个`);
  lines.push(`- 总时长: **${profile.summary.totalDurationReadable}**\n`);
  
  lines.push('## 歌单分布（含完整数据）');
  playlistStats.forEach(stat => {
    lines.push(`- **${stat.name}**: API返回 ${stat.total} 首，新增 ${stat.newCount} 首，跨歌单重复 ${stat.dupCount} 首`);
  });
  lines.push('');
  
  lines.push('## 最常听的艺术家（Top 20）');
  profile.topArtists.forEach(([artist, count], i) => {
    lines.push(`${i + 1}. ${artist} (${count} 首)`);
  });
  lines.push('');
  
  lines.push('## 听歌排行（总榜 Top 20）');
  profile.topPlayed.forEach((song, i) => {
    lines.push(`${i + 1}. ${song.name} - ${song.artist} (播放 ${song.playCount} 次)`);
  });
  lines.push('');
  
  lines.push('## 最近播放（最新 20 首）');
  profile.recentPlays.forEach((song, i) => {
    const time = new Date(song.playTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    lines.push(`${i + 1}. ${song.name} - ${song.artist} (${time})`);
  });
  lines.push('');
  
  lines.push('## 近期最爱艺术家（最近播放统计）');
  profile.recentTopArtists.forEach(([artist, count], i) => {
    lines.push(`${i + 1}. ${artist} (${count} 次)`);
  });
  
  return lines.join('\n');
}

// ============ 主流程 ============

async function main() {
  console.log('='.repeat(50));
  console.log('  音乐画像分析工具');
  console.log('='.repeat(50));

  // 验证登录
  const accountRes = await request(`/user/account?timestamp=${Date.now()}`);
  if (accountRes.code !== 200 || !accountRes.account) {
    throw new Error('Cookie 无效或已过期');
  }
  const uid = accountRes.account.id;
  console.log(`\n✅ 用户: ${accountRes.profile?.nickname} (uid: ${uid})\n`);

  // 创建输出目录
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. 导出全部歌单（含多歌单归属）
  const { allSongs, playlistStats, playlists } = await exportAllPlaylists(uid);

  // 2. 获取听歌排行
  const { weekRecords, allTimeRecords } = await getPlayRecords(uid);

  // 3. 获取最近播放
  const recentPlays = await getRecentPlays();

  // 4. 分析
  const profile = analyzeProfile(allSongs, weekRecords, allTimeRecords, recentPlays, playlists);
  
  // 5. 生成报告
  const report = generateReport(profile, playlists, playlistStats);

  // 保存结果
  const reportPath = path.join(OUTPUT_DIR, 'report.md');
  const songsPath = path.join(OUTPUT_DIR, 'all-songs.json');
  const recordsPath = path.join(OUTPUT_DIR, 'play-records.json');

  fs.writeFileSync(reportPath, report, 'utf-8');
  fs.writeFileSync(songsPath, JSON.stringify(allSongs, null, 2), 'utf-8');
  fs.writeFileSync(recordsPath, JSON.stringify({ weekRecords, allTimeRecords, recentPlays }, null, 2), 'utf-8');

  console.log('\n' + '='.repeat(50));
  console.log('  分析完成！');
  console.log('='.repeat(50));
  console.log(`   听歌画像报告: ${reportPath}`);
  console.log(`   完整歌曲数据: ${songsPath}`);
  console.log(`   听歌记录数据: ${recordsPath}`);
  console.log(`   去重歌曲数: ${allSongs.length}`);
  console.log(`   总榜记录数: ${allTimeRecords.length}`);
  console.log(`   最近播放: ${recentPlays.length}`);
  console.log('');
}

main().catch((err) => {
  console.error(`\n❌ 错误: ${err.message}`);
  process.exit(1);
});
