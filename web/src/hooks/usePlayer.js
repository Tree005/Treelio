// src/hooks/usePlayer.js — 播放器状态管理
import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../utils/api';

const LIKED_KEY = 'treelio-liked-songs';

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

function formatTime(ms) {
  if (!ms || isNaN(ms)) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

export function usePlayer() {
  const audioRef = useRef(null);
  const currentSongRef = useRef(null); // 用 ref 持久持有当前歌曲，error 回调中可访问
  const [currentSong, setCurrentSong] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [liked, setLiked] = useState(false);
  const likedSetRef = useRef(loadLikedSongs());
  const retryCountRef = useRef(0); // 防止无限重试
  const MAX_RETRIES = 2;

  // 刷新播放 URL 并继续播放（记录当前进度，尝试从断点续播）
  const refreshAndResume = useCallback(async () => {
    const song = currentSongRef.current;
    const audio = audioRef.current;
    if (!song?.id || !audio) return;

    // 防止无限重试
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
      // 更新 URL 并从断点续播
      audio.src = info.url;
      audio.currentTime = Math.min(savedTime, audio.duration || 0);
      await audio.play();
      setPlaying(true);
      // 重置重试计数
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
    });

    audio.addEventListener('error', () => {
      const mediaErr = audio.error;
      console.error('[Player] Audio error:', mediaErr?.message || 'unknown', 'code:', mediaErr?.code);
      // code 2 = NETWORK_ERROR (URL 过期/不可达) 或 code 3 = DECODE_ERROR
      // 自动刷新 URL 尝试恢复
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
  }, [refreshAndResume]);

  const play = useCallback(async (song) => {
    if (!song) return;

    let url = song.url;
    // 如果只有 id 没有 url，先获取 url
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
    retryCountRef.current = 0; // 新歌，重置重试计数

    audio.play().then(() => {
      setPlaying(true);
      setCurrentTime(0);
      const songWithUrl = { ...song, url };
      setCurrentSong(songWithUrl);
      currentSongRef.current = songWithUrl;
      const isLiked = song.id && likedSetRef.current.has(String(song.id));
      setLiked(isLiked);
      // 上报播放记录（静默，不影响播放）
      if (song.id) {
        api.reportPlay(String(song.id), song.name, song.artist).catch(() => {});
      }
    }).catch(err => {
      console.error('播放失败:', err);
    });
  }, []);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio.src && !currentSongRef.current) return;

    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      // 尝试播放，如果失败则刷新 URL
      try {
        await audio.play();
        setPlaying(true);
      } catch (err) {
        console.warn('[Player] 直接播放失败，尝试刷新 URL:', err.message);
        await refreshAndResume();
      }
    }
  }, [playing, refreshAndResume]);

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
    play,
    togglePlay,
    seek,
    toggleLike,
    formatTime,
  };
}
