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
  const [currentSong, setCurrentSong] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [liked, setLiked] = useState(false);
  const likedSetRef = useRef(loadLikedSongs());

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
    });

    audio.addEventListener('error', (e) => {
      console.error('Audio error:', e);
      setPlaying(false);
    });

    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

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

    audioRef.current.src = url;
    audioRef.current.play().then(() => {
      setPlaying(true);
      setCurrentTime(0);
      setCurrentSong({ ...song, url });
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

  const togglePlay = useCallback(() => {
    if (!audioRef.current.src) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play().then(() => setPlaying(true));
    }
  }, [playing]);

  const seek = useCallback((ratio) => {
    if (!audioRef.current.duration) return;
    audioRef.current.currentTime = audioRef.current.duration * ratio;
    setCurrentTime(audioRef.current.currentTime * 1000);
  }, []);

  const toggleLike = useCallback(() => {
    const songId = audioRef.current?.src && currentSong?.id ? String(currentSong.id) : null;
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
