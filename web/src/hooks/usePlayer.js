// src/hooks/usePlayer.js — 播放器状态管理 + 队列（单例 + 多 listener 广播）
import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../utils/api';

const LIKED_KEY = 'treelio-liked-songs';
const QUEUE_KEY = 'treelio-play-queue';

// ========================
// 模块级单例（所有 usePlayer 调用共享）
// ========================

function loadLikedSongs() {
  try {
    const raw = localStorage.getItem(LIKED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveLikedSongs(set) {
  localStorage.setItem(LIKED_KEY, JSON.stringify([...set]));
}

function loadQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return { queue: [], index: -1 };
    const data = JSON.parse(raw);
    return { queue: Array.isArray(data.queue) ? data.queue : [], index: data.index ?? -1 };
  } catch { return { queue: [], index: -1 }; }
}

function saveQueueData(queue, index) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify({ queue, index })); } catch {}
}

function formatTime(ms) {
  if (!ms || isNaN(ms)) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

// ---- 单例变量 ----
let _audio = null;
let _currentSong = null;
let _likedSet = loadLikedSongs();
let _retryCount = 0;
const MAX_RETRIES = 2;

// 队列单例
let _queue = [];
let _queueIndex = -1;

// 广播 listeners（Set of setState functions）
const _listeners = new Set();

/** 向所有已注册 listener 广播 state 更新 */
function broadcast(partial) {
  for (const setter of _listeners) {
    setter(s => ({ ...s, ...partial }));
  }
}

/** 初始化/获取全局 Audio 实例 */
function getAudio() {
  if (!_audio) {
    _audio = new Audio();
    _audio.addEventListener('timeupdate', () => {
      broadcast({ currentTime: _audio.currentTime * 1000 });
    });
    _audio.addEventListener('loadedmetadata', () => {
      broadcast({ duration: _audio.duration * 1000 });
    });
    _audio.addEventListener('ended', () => {
      broadcast({ playing: false, currentTime: 0 });
      const nextIdx = _queueIndex + 1;
      if (nextIdx < _queue.length) {
        _queueIndex = nextIdx;
        playSongInternal(_queue[nextIdx]);
        setTimeout(() => broadcast({ queue: [..._queue], queueIndex: nextIdx }), 0);
      }
    });
    _audio.addEventListener('error', () => {
      if (_currentSong?.id) refreshAndResume();
      else broadcast({ playing: false });
    });
  }
  return _audio;
}

/** 内部播放函数 */
async function playSongInternal(song) {
  if (!song) return;
  let url = song.url;
  if (!url && song.id) {
    try {
      const info = await api.getSongUrl(song.id);
      url = info.url;
    } catch (e) {
      console.error('[player] 获取链接失败:', e.message);
      return;
    }
  }
  if (!url) return;

  const audio = getAudio();
  _retryCount = 0;
  audio.src = url;

  audio.play().then(() => {
    const songWithUrl = { ...song, url };
    _currentSong = songWithUrl;
    const isLiked = song.id && _likedSet.has(String(song.id));
    broadcast({
      currentSong: songWithUrl,
      liked: isLiked,
      playing: true,
      currentTime: 0,
    });
    if (song.id) api.reportPlay(String(song.id), song.name, song.artist).catch(() => {});
  }).catch(err => {
    console.error('[player] 播放失败:', err);
  });
}

async function refreshAndResume() {
  const song = _currentSong;
  const audio = getAudio();
  if (!song?.id) return;

  if (_retryCount >= MAX_RETRIES) {
    _retryCount = 0;
    broadcast({ playing: false });
    return;
  }
  _retryCount++;
  const savedTime = audio.currentTime;
  try {
    const info = await api.getSongUrl(song.id);
    if (!info.url) { broadcast({ playing: false }); return; }
    audio.src = info.url;
    audio.currentTime = Math.min(savedTime, audio.duration || 0);
    await audio.play();
    _retryCount = 0;
    broadcast({ playing: true });
  } catch (e) {
    broadcast({ playing: false });
  }
}

// ========================
// 公开 Hook
// ========================

export function usePlayer() {
  // 每个调用者有自己的 React state，但初始值来自共享单例
  const [state, setState] = useState(() => {
    const init = loadQueue();
    _queue = init.queue;
    _queueIndex = init.index;
    _currentSong = init.index >= 0 && init.index < init.queue.length ? init.queue[init.index] : null;
    return {
      currentSong: _currentSong,
      playing: false,
      currentTime: 0,
      duration: 0,
      liked: false,
      queue: [..._queue],
      queueIndex: _queueIndex,
    };
  });

  // 注册 listener
  useEffect(() => {
    _listeners.add(setState);
    // 同步当前最新状态到这个新 listener
    setState({
      currentSong: _currentSong,
      playing: !_audio?.paused && !!_audio?.src,
      currentTime: (_audio?.currentTime || 0) * 1000,
      duration: (_audio?.duration || 0) * 1000,
      liked: _currentSong?.id ? _likedSet.has(String(_currentSong.id)) : false,
      queue: [..._queue],
      queueIndex: _queueIndex,
    });
    return () => { _listeners.delete(setState); };
  }, []);

  // 持久化队列
  useEffect(() => {
    saveQueueData(state.queue, state.queueIndex);
  }, [state.queue, state.queueIndex]);

  // ====================
  // API 函数
  // ====================

  const insertAndPlay = useCallback(async (song) => {
    if (!song) return;
    const songObj = { id: song.id, name: song.name, artist: song.artist, album: song.album, coverUrl: song.coverUrl, duration: song.duration };
    const existingIdx = _queue.findIndex(s => String(s.id) === String(songObj.id));
    if (existingIdx >= 0) {
      _queueIndex = existingIdx;
      broadcast({ queue: [..._queue], queueIndex: existingIdx });
      playSongInternal(_queue[existingIdx]);
      return;
    }
    _queue.splice(_queueIndex + 1, 0, songObj); // 插入到当前之后
    _queueIndex += 1;
    broadcast({ queue: [..._queue], queueIndex: _queueIndex });
    playSongInternal(songObj);
  }, []);

  const play = useCallback(async (song) => {
    if (!song) return;
    const newQueue = [{ id: song.id, name: song.name, artist: song.artist, album: song.album, coverUrl: song.coverUrl, duration: song.duration }];
    _queue = newQueue;
    _queueIndex = 0;
    broadcast({ queue: [...newQueue], queueIndex: 0 });
    playSongInternal(newQueue[0]);
  }, []);

  const enqueueAndPlay = useCallback(async (songs) => {
    if (!songs?.length) return;
    const cleanSongs = songs.map(s => ({
      id: s.id, name: s.name, artist: s.artist, album: s.album, coverUrl: s.coverUrl, duration: s.duration,
    }));
    // 追加到当前位置之后
    _queue = [..._queue.slice(0, _queueIndex + 1), ...cleanSongs, ..._queue.slice(_queueIndex + 1)];
    const nextIdx = _queueIndex + 1;
    _queueIndex = nextIdx;
    broadcast({ queue: [..._queue], queueIndex: nextIdx });
    playSongInternal(_queue[nextIdx]);
  }, []);

  const addToQueue = useCallback((songs) => {
    const list = Array.isArray(songs) ? songs : [songs];
    if (!list.length) return;
    const ids = new Set(_queue.map(s => String(s.id)));
    const newSongs = list.filter(s => !ids.has(String(s.id))).map(s => ({
      id: s.id, name: s.name, artist: s.artist, album: s.album, coverUrl: s.coverUrl, duration: s.duration,
    }));
    if (!newSongs.length) return;
    _queue.push(...newSongs);
    broadcast({ queue: [..._queue] });
  }, []);

  const playNext = useCallback(() => {
    const nextIdx = _queueIndex + 1;
    if (nextIdx < _queue.length) {
      _queueIndex = nextIdx;
      broadcast({ queue: [..._queue], queueIndex: nextIdx });
      playSongInternal(_queue[nextIdx]);
    }
  }, []);

  const playPrevious = useCallback(() => {
    const audio = getAudio();
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      broadcast({ currentTime: 0 });
      return;
    }
    const prevIdx = _queueIndex - 1;
    if (prevIdx >= 0) {
      _queueIndex = prevIdx;
      broadcast({ queue: [..._queue], queueIndex: prevIdx });
      playSongInternal(_queue[prevIdx]);
    }
  }, []);

  const stop = useCallback(() => {
    const audio = getAudio();
    audio.pause();
    audio.src = '';
    _currentSong = null;
    _queue = [];
    _queueIndex = -1;
    broadcast({ playing: false, currentTime: 0, currentSong: null, queue: [], queueIndex: -1 });
  }, []);

  const clearQueue = useCallback(() => {
    _queue = [];
    _queueIndex = -1;
    broadcast({ queue: [], queueIndex: -1 });
  }, []);

  const removeFromQueue = useCallback((index) => {
    const currentIdx = _queueIndex;
    if (index < 0 || index >= _queue.length) return;

    _queue.splice(index, 1);

    if (index === currentIdx) {
      const nextIdx = index < _queue.length ? index : index - 1;
      if (nextIdx >= 0) {
        _queueIndex = nextIdx;
        broadcast({ queue: [..._queue], queueIndex: nextIdx });
        playSongInternal(_queue[nextIdx]);
      } else {
        const audio = getAudio();
        audio.pause(); audio.src = '';
        _currentSong = null; _queueIndex = -1;
        broadcast({ playing: false, currentSong: null, queue: [..._queue], queueIndex: -1 });
      }
    } else if (index < currentIdx) {
      _queueIndex -= 1;
      broadcast({ queue: [..._queue], queueIndex: _queueIndex });
    } else {
      broadcast({ queue: [..._queue] });
    }
  }, []);

  // 点击队列中某首 → 移到当前播放位置并立即播放
  const jumpToTrack = useCallback((targetIndex) => {
    if (targetIndex < 0 || targetIndex >= _queue.length) return;
    if (targetIndex === _queueIndex) return; // 已经是当前曲目

    const targetSong = _queue[targetIndex];
    // 从原位置移除
    _queue.splice(targetIndex, 1);
    // 插入到当前播放位置之后（成为下一首播放）
    _queue.splice(_queueIndex + 1, 0, targetSong);
    _queueIndex += 1;
    broadcast({ queue: [..._queue], queueIndex: _queueIndex });
    playSongInternal(targetSong);
  }, []);

  const togglePlay = useCallback(async () => {
    const audio = getAudio();
    if (!audio.src && !_currentSong) return;
    if (state.playing) {
      audio.pause();
      broadcast({ playing: false });
    } else {
      if (!audio.src && _currentSong?.id) { playSongInternal(_currentSong); return; }
      try { await audio.play(); broadcast({ playing: true }); }
      catch (err) { refreshAndResume(); }
    }
  }, [state.playing]);

  const seek = useCallback((ratio) => {
    const audio = getAudio();
    if (!audio.duration) return;
    audio.currentTime = audio.duration * ratio;
    broadcast({ currentTime: audio.currentTime * 1000 });
  }, []);

  const toggleLike = useCallback(() => {
    const songId = _currentSong?.id ? String(_currentSong.id) : null;
    if (songId) {
      if (_likedSet.has(songId)) _likedSet.delete(songId);
      else _likedSet.add(songId);
      saveLikedSongs(_likedSet);
    }
    broadcast({ liked: !state.liked });
  }, [state.liked]);

  return {
    ...state,
    insertAndPlay,
    play,
    togglePlay,
    seek,
    toggleLike,
    enqueueAndPlay,
    addToQueue,
    playNext,
    playPrevious,
    stop,
    clearQueue,
    removeFromQueue,
    jumpToTrack,
    formatTime,
  };
}
