// server/services/netease.js — 网易云音乐 API 代理
import fetch from 'node-fetch';
import config from '../config.js';

const BASE = config.netease.baseUrl;

async function request(path, params = {}) {
  const url = new URL(path, BASE);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const headers = { 'Content-Type': 'application/json' };
  if (config.netease.musicU) {
    headers['Cookie'] = `MUSIC_U=${config.netease.musicU}`;
  }

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`网易云 API 错误 ${res.status}`);
  return res.json();
}

// 搜索歌曲
export async function searchSongs(keyword, limit = 10) {
  const data = await request('/cloudsearch', { keywords: keyword, limit });
  const songs = data.result?.songs || [];
  return songs.map(s => ({
    id: String(s.id),
    name: s.name,
    artist: (s.ar || s.artists || []).map(a => a.name).join(' / '),
    album: s.al?.name || s.album?.name || '',
    duration: s.dt, // ms
    coverUrl: s.al?.picUrl || '',
  }));
}

// 获取歌曲播放 URL
export async function getSongUrl(id) {
  const data = await request('/song/url', { id });
  const urls = data.data || [];
  if (urls.length === 0) throw new Error('无法获取播放链接');
  const song = urls[0];
  if (song.url === null) throw new Error('该歌曲暂无版权或需要 VIP');
  return {
    id: String(song.id),
    url: song.url,
    md5: song.md5,
    type: song.type,
  };
}

// 获取歌词
export async function getLyric(id) {
  const data = await request('/lyric', { id });
  return {
    lrc: data.lrc?.lyric || '',
    tlyric: data.tlyric?.lyric || '',
  };
}

// 根据歌名+艺人搜索（用于 AI 推荐后的精确匹配）
// 新增：搜索后校验艺人名，减少"同名不同人"误匹配
export async function findSong(name, artist) {
  const keyword = artist ? `${name} ${artist}` : name;
  const results = await searchSongs(keyword, 5);

  if (results.length === 0) return null;

  // 艺人名校验：大小写不敏感，支持部分匹配
  if (artist) {
    const artistLower = artist.toLowerCase();
    const matched = results.find(s => {
      const songArtist = (s.artist || '').toLowerCase();
      return songArtist.includes(artistLower) || artistLower.includes(songArtist.replace(/\s*\/\s*/g, ''));
    });
    if (matched) {
      console.log(`[findSong] 艺人匹配 ✓ "${name}" - "${matched.artist}"`);
      return matched;
    }
    // 没匹配到，打 warn 但返回第一名结果
    console.warn(`[findSong] 艺人不匹配 ⚠️ 期望:"${artist}" 实际:"${results[0].artist}" | 歌名:"${name}"`);
  }

  // 歌名精确匹配（忽略大小写）
  const nameMatched = results.find(s =>
    s.name.toLowerCase() === name.toLowerCase()
  );
  if (nameMatched) return nameMatched;

  // 兜底：返回第一个结果
  return results[0];
}
