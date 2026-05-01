// server/services/song-index.js — 本地歌曲索引
// 从用户歌单构建内存索引，AI 推荐歌曲时优先本地匹配，避免依赖 AI 猜 ID 或外部搜索

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import config from '../config.js';

let _index = null;  // Map<normalized_name, song[]>
let _artistIndex = null;  // Map<normalized_artist, song[]>
let _loaded = false;

/**
 * 标准化字符串用于模糊匹配：小写 + 去除特殊字符
 */
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[\s\-_()（）[\]【】「」《》"'""·,.!?！？。，、:：;；]/g, '');
}

/**
 * 加载歌曲索引
 */
function loadIndex() {
  if (_loaded) return;

  const allSongsPath = resolve(config.dataDir, 'music-profile', 'all-songs.json');
  if (!existsSync(allSongsPath)) {
    console.warn('[song-index] all-songs.json 不存在，跳过本地索引');
    _index = new Map();
    _artistIndex = new Map();
    _loaded = true;
    return;
  }

  try {
    const songs = JSON.parse(readFileSync(allSongsPath, 'utf-8'));
    _index = new Map();
    _artistIndex = new Map();

    for (const song of songs) {
      if (!song.name) continue;
      const key = normalize(song.name);
      if (!_index.has(key)) _index.set(key, []);
      _index.get(key).push(song);

      // 艺术家索引（支持按 artist 过滤）
      if (song.artist) {
        const artistKey = normalize(song.artist);
        if (!_artistIndex.has(artistKey)) _artistIndex.set(artistKey, []);
        _artistIndex.get(artistKey).push(song);
      }
    }

    console.log(`[song-index] 已加载 ${songs.length} 首歌到本地索引`);
    _loaded = true;
  } catch (e) {
    console.error('[song-index] 加载失败:', e.message);
    _index = new Map();
    _artistIndex = new Map();
    _loaded = true;
  }
}

/**
 * 在本地歌单中查找歌曲
 * @param {string} name - 歌名
 * @param {string} [artist] - 艺术家（可选，用于缩小范围）
 * @returns {Object|null} 匹配到的歌曲对象，含 id/name/artist/album/coverUrl/duration
 */
export function findLocal(name, artist) {
  loadIndex();
  if (!_index?.size) return null;

  const key = normalize(name);
  let candidates = _index.get(key);

  // 精确匹配失败 → 尝试包含匹配（处理歌名缩写情况）
  if (!candidates?.length) {
    for (const [idx, songs] of _index) {
      if (idx.includes(key) || key.includes(idx)) {
        candidates = songs;
        break;
      }
    }
  }

  if (!candidates?.length) return null;

  // 如果有 artist，优先匹配同艺术家的
  if (artist && candidates.length > 1) {
    const artistKey = normalize(artist);
    const exact = candidates.find(s => {
      const sa = normalize(s.artist);
      // 艺术家名称包含匹配（处理 "坂本龍一" vs "Ryuichi Sakamoto"）
      return sa.includes(artistKey) || artistKey.includes(sa)
        || s.artist?.includes(artist) || artist?.includes(s.artist);
    });
    if (exact) return toSongObj(exact);
  }

  return toSongObj(candidates[0]);
}

/**
 * 在本地歌单中按艺术家搜索
 * @param {string} artist - 艺术家名
 * @returns {Array} 匹配的歌曲列表
 */
export function findByArtist(artist) {
  loadIndex();
  if (!_artistIndex?.size) return [];

  const key = normalize(artist);
  const results = _artistIndex.get(key) || [];

  // 包含匹配
  if (!results.length) {
    for (const [idx, songs] of _artistIndex) {
      if (idx.includes(key) || key.includes(idx)) {
        return songs.map(toSongObj);
      }
    }
  }

  return results.map(toSongObj);
}

/**
 * 统一歌曲对象格式
 */
function toSongObj(song) {
  return {
    id: String(song.id || ''),
    name: song.name || '',
    artist: song.artist || '',
    album: song.album || song.alName || '',
    coverUrl: song.coverUrl || song.picUrl || song.albumPic || '',
    duration: song.duration || song.dt || 0,
    _local: true,  // 标记来自本地歌单
  };
}

/**
 * 重新加载索引（歌单数据更新后调用）
 */
export function reloadIndex() {
  _loaded = false;
  loadIndex();
}

/**
 * 获取索引状态
 */
export function getIndexStats() {
  loadIndex();
  return {
    loaded: _loaded,
    songCount: _index?.size || 0,
  };
}
