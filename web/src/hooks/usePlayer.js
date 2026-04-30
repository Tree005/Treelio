// src/hooks/usePlayer.js — 播放器状态管理 + 队列
import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../utils/api';

const LIKED_KEY = 'treelio-liked-songs';
const QUEUE_KEY = 'treelio-play-queue';

function loadLikedSongs() {
  try {
    const raw = localStorage.getItem(LIKED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
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
  } catch {
    return { queue: [], index: -1 };
  }
}

function saveQueueData(queue, index) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify({ queue, index }));
  } catch {
    // localStorage 满了，忽略
  }
}

function formatTime(ms) {
  if (!ms || isNaN(ms)) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

export function usePlayer() {
  const audioRef = useRef(null);
  const currentSongRef = useRef(null);
  const [currentSong, setCurrentSong] = useState(() => {
    const { queue: q, index } = loadQueue();
    if (index >= 0 && index < q.length) return q[index];
    return null;
  });
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [liked, setLiked] = useState(false);
  const likedSetRef = useRef(loadLikedSongs());
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 2;

  // 队列状态
  const [queue, setQueue] = useState(() => loadQueue().queue);
  const [queueIndex, setQueueIndex] = useState(() => loadQueue().index);
  const queueRef = useRef(queue);
  const queueIndexRef = useRef(queueIndex);

  // 保持 ref 同步
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { queueIndexRef.current = queueIndex; }, [queueIndex]);

  // 持久化队列
  useEffect(() => {
    saveQueueData(queue, queueIndex);
  }, [queue, queueIndex]);

  // 保持 currentSongRef 与 currentSong 同步
  useEffect(() => {
    if (currentSong) {
      currentSongRef.current = currentSong;
    }
  }, [currentSong]);

  // 内部：播放一首歌（共享逻辑，不改变队列）
  const playSong = useCallback(async (song) => {
    if (!song) return;

    let url = song.url;
    if (!url && song.id) {
      try {
        const info = await api.getSongUrl(song.id);
        url = info.url;
      } catch (err) {
        console.error('获取播放链接失败:', err);
        return;
      }
    }
    if (!url) return;

    const audio = audioRef.current;
    audio.src = url;
    retryCountRef.current = 0;

    audio.play().then(() => {
      setPlaying(true);
      setCurrentTime(0);
      const songWithUrl = { ...song, url };
      setCurrentSong(songWithUrl);
      currentSongRef.current = songWithUrl;
      const isLiked = song.id && likedSetRef.current.has(String(song.id));
      setLiked(isLiked);
      if (song.id) {
        api.reportPlay(String(song.id), song.name, song.artist).catch(() => {});
      }
    }).catch(err => {
      console.error('播放失败:', err);
    });
  }, []);

  // 内部：播放队列中指定位置的歌曲
  const playQueueItem = useCallback(async (index) => {
    const q = queueRef.current;
    if (index < 0 || index >= q.length) return;
    setQueueIndex(index);
    await playSong(q[index]);
  }, [playSong]);

  // 刷新播放 URL 并继续播放
  const refreshAndResume = useCallback(async () => {
    const song = currentSongRef.current;
    const audio = audioRef.current;
    if (!song?.id || !audio) return;

    if (retryCountRef.current >= MAX_RETRIES) {
      console.warn('播放重试次数已达上限，停止重试');
      retryCountRef.current = 0;
      setPlaying(false);
      return;
    }

    retryCountRef.current += 1;
    const savedTime = audio.currentTime;
    console.log(`[Player] URL 可能已过期，正在刷新... (第 ${retryCountRef.current} 次)`);

    try {
      const info = await api.getSongUrl(song.id);
      if (!info.url) {
        console.error('[Player] 刷新 URL 失败：无有效链接');
        setPlaying(false);
        return;
      }
      audio.src = info.url;
      audio.currentTime = Math.min(savedTime, audio.duration || 0);
      await audio.play();
      setPlaying(true);
      retryCountRef.current = 0;
    } catch (err) {
      console.error('[Player] 刷新 URL 失败:', err);
      setPlaying(false);
    }
  }, []);

  // 初始化 audio 元素
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    audio.addEventListener('timeupdate', () => {
      setCurrentTime(audio.currentTime * 1000);
    });

    audio.addEventListener('loadedmetadata', () => {
      setDuration(audio.duration * 1000);
    });

    audio.addEventListener('ended', () => {
      setPlaying(false);
      setCurrentTime(0);
      retryCountRef.current = 0;
      // 自动播放下一首
      const nextIndex = queueIndexRef.current + 1;
      const q = queueRef.current;
      if (nextIndex < q.length) {
        setQueueIndex(nextIndex);
        playSong(q[nextIndex]);
      }
    });

    audio.addEventListener('error', () => {
      const mediaErr = audio.error;
      console.error('[Player] Audio error:', mediaErr?.message || 'unknown', 'code:', mediaErr?.code);
      if (currentSongRef.current?.id) {
        refreshAndResume();
      } else {
        setPlaying(false);
      }
    });

    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [refreshAndResume, playSong]);

  // 将歌曲插入队列当前位置+1并播放（点击聊天区歌曲卡片时用）
  // 如果歌曲已在队列中，直接跳转播放（不去重插入）
  const insertAndPlay = useCallback(async (song) => {
    if (!song) return;
    const songObj = {
      id: song.id,
      name: song.name,
      artist: song.artist,
      album: song.album,
      coverUrl: song.coverUrl,
      duration: song.duration,
    };
    const q = queueRef.current;
    // 去重：如果已在队列中，直接跳转
    const existingIndex = q.findIndex(s => String(s.id) === String(songObj.id));
    if (existingIndex >= 0) {
      setQueueIndex(existingIndex);
      await playSong(q[existingIndex]);
      return;
    }
    // 不在队列中，插入到当前位置+1
    const currentIdx = queueIndexRef.current;
    const newQueue = [...q.slice(0, currentIdx + 1), songObj, ...q.slice(currentIdx + 1)];
    setQueue(newQueue);
    setQueueIndex(currentIdx + 1);
    await playSong(songObj);
  }, [playSong]);

  // 直接播放一首歌（清空队列，重新开始）
  const play = useCallback(async (song) => {
    if (!song) return;
    const newQueue = [{ id: song.id, name: song.name, artist: song.artist, album: song.album, coverUrl: song.coverUrl, duration: song.duration }];
    setQueue(newQueue);
    setQueueIndex(0);
    await playSong(song);
  }, [playSong]);

  // 推荐歌曲入队并播放第一首
  const enqueueAndPlay = useCallback(async (songs) => {
    if (!songs?.length) return;
    const cleanSongs = songs.map(s => ({
      id: s.id,
      name: s.name,
      artist: s.artist,
      album: s.album,
      coverUrl: s.coverUrl,
      duration: s.duration,
    }));
    setQueue(cleanSongs);
    setQueueIndex(0);
    await playSong(cleanSongs[0]);
  }, [playSong]);

  // 添加歌曲到队列末尾（兼容单个对象或数组，自动去重）
  const addToQueue = useCallback((songs) => {
    const list = Array.isArray(songs) ? songs : [songs];
    if (list.length === 0) return;
    const q = queueRef.current;
    const existingIds = new Set(q.map(s => String(s.id)));
    const newSongs = [];
    for (const s of list) {
      const id = String(s.id);
      if (!existingIds.has(id)) {
        existingIds.add(id);
        newSongs.push({
          id: s.id,
          name: s.name,
          artist: s.artist,
          album: s.album,
          coverUrl: s.coverUrl,
          duration: s.duration,
        });
      }
    }
    if (newSongs.length === 0) return; // 全部已存在，跳过
    setQueue(prev => [...prev, ...newSongs]);
  }, []);

  // 下一首
  const playNext = useCallback(() => {
    const nextIndex = queueIndexRef.current + 1;
    const q = queueRef.current;
    if (nextIndex < q.length) {
      setQueueIndex(nextIndex);
      playSong(q[nextIndex]);
    }
  }, [playSong]);

  // 上一首（>3秒重头播，否则上一首）
  const playPrevious = useCallback(() => {
    const audio = audioRef.current;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    const prevIndex = queueIndexRef.current - 1;
    if (prevIndex >= 0) {
      const q = queueRef.current;
      setQueueIndex(prevIndex);
      playSong(q[prevIndex]);
    }
  }, [playSong]);

  // 停止播放，清空队列
  const stop = useCallback(() => {
    const audio = audioRef.current;
    audio.pause();
    audio.src = '';
    setPlaying(false);
    setCurrentTime(0);
    setCurrentSong(null);
    currentSongRef.current = null;
    setQueue([]);
    setQueueIndex(-1);
  }, []);

  // 清空队列（不停止当前播放）
  const clearQueue = useCallback(() => {
    setQueue([]);
    setQueueIndex(-1);
  }, []);

  // 从队列中移除指定歌曲
  const removeFromQueue = useCallback((index) => {
    const currentIndex = queueIndexRef.current;
    const q = queueRef.current;

    if (index < 0 || index >= q.length) return;

    setQueue(prev => prev.filter((_, i) => i !== index));

    if (index === currentIndex) {
      // 移除的是当前播放的歌 → 播下一首或停止
      const nextIndex = index < q.length - 1 ? index : index - 1;
      if (nextIndex >= 0 && nextIndex < q.length - 1) {
        setQueueIndex(nextIndex);
        playSong(q.filter((_, i) => i !== index)[nextIndex]);
      } else {
        // 队列空了
        const audio = audioRef.current;
        audio.pause();
        audio.src = '';
        setPlaying(false);
        setCurrentSong(null);
        currentSongRef.current = null;
        setQueueIndex(-1);
      }
    } else if (index < currentIndex) {
      // 移除在当前之前 → index 减 1
      setQueueIndex(prev => prev - 1);
    }
  }, [playSong]);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    const song = currentSongRef.current;
    if (!audio.src && !song) return;

    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      // 无 src 时先获取播放链接
      if (!audio.src && song?.id) {
        await playSong(song);
        return;
      }
      try {
        await audio.play();
        setPlaying(true);
      } catch (err) {
        console.warn('[Player] 直接播放失败，尝试刷新 URL:', err.message);
        await refreshAndResume();
      }
    }
  }, [playing, refreshAndResume, playSong]);

  const seek = useCallback((ratio) => {
    if (!audioRef.current.duration) return;
    audioRef.current.currentTime = audioRef.current.duration * ratio;
    setCurrentTime(audioRef.current.currentTime * 1000);
  }, []);

  const toggleLike = useCallback(() => {
    const songId = currentSongRef.current?.id ? String(currentSongRef.current.id) : null;
    if (songId) {
      if (likedSetRef.current.has(songId)) {
        likedSetRef.current.delete(songId);
      } else {
        likedSetRef.current.add(songId);
      }
      saveLikedSongs(likedSetRef.current);
    }
    setLiked(v => !v);
  }, [currentSong]);

  return {
    currentSong,
    playing,
    currentTime,
    duration,
    liked,
    queue,
    queueIndex,
    insertAndPlay,
    // 播放
    play,
    togglePlay,
    seek,
    toggleLike,
    // 队列
    enqueueAndPlay,
    addToQueue,
    playNext,
    playPrevious,
    stop,
    clearQueue,
    removeFromQueue,
    // 工具
    formatTime,
  };
}
