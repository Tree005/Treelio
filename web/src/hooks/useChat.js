// src/hooks/useChat.js — 对话状态管理
import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../utils/api';

const STORAGE_KEY = 'treelio-chat-messages';

function loadMessages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed.map(msg => ({
      ...msg,
      time: new Date(msg.time),
    }));
  } catch {
    return [];
  }
}

function saveMessages(messages) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // localStorage 满了或不可用，忽略
  }
}

export function useChat(onPlaySong, onEnqueueSongs) {
  const [messages, setMessages] = useState(loadMessages);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  // 消息变化时自动保存
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

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

      // AI 推荐歌曲 → 全部入队并播放第一首
      if (result.songs?.length > 0 && result.songs[0].id && onEnqueueSongs) {
        onEnqueueSongs(result.songs);
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
  }, [loading, onEnqueueSongs]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { messages, loading, sendMessage, clearMessages };
}
