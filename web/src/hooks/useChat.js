// src/hooks/useChat.js — 对话状态管理
import { useState, useCallback, useRef } from 'react';
import { api } from '../utils/api';

export function useChat(onPlaySong) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return;

    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: text.trim(),
      time: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const result = await api.chat(text.trim());

      const claudioMsg = {
        id: Date.now() + 1,
        role: 'claudio',
        content: result.reply || '',
        songs: result.songs || [],
        mood: result.mood || 'neutral',
        time: new Date(),
      };

      setMessages(prev => [...prev, claudioMsg]);

      // 如果有推荐歌曲，自动播放第一首
      if (result.songs?.length > 0 && result.songs[0].url && onPlaySong) {
        onPlaySong(result.songs[0]);
      }
    } catch (err) {
      const errMsg = {
        id: Date.now() + 1,
        role: 'claudio',
        content: `出了点问题：${err.message}`,
        time: new Date(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  }, [loading, onPlaySong]);

  return { messages, loading, sendMessage };
}
