// src/utils/api.js — fetch 封装
const BASE = '/api';

async function request(path, options = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || `请求失败 ${res.status}`);
  }

  return res.json();
}

export const api = {
  // 对话
  chat(message) {
    return request('/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  },

  // 搜索歌曲
  searchMusic(keyword, limit = 10) {
    return request(`/music/search?q=${encodeURIComponent(keyword)}&limit=${limit}`);
  },

  // 获取播放 URL
  getSongUrl(id) {
    return request(`/music/url?id=${encodeURIComponent(id)}`);
  },

  // 获取歌词
  getLyric(id) {
    return request(`/music/lyric?id=${encodeURIComponent(id)}`);
  },
};
