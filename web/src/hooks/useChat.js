// src/hooks/useChat.js — 对话状态管理
import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../utils/api';

const STORAGE_KEY = 'treelio-chat-messages';

function loadMessages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // 反序列化日期字符串
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

export function useChat(onPlaySong) {
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

      // 如果有推荐歌曲，自动播放第一首（usePlayer.play 会自动获取 url）
      if (result.songs?.length > 0 && result.songs[0].id && onPlaySong) {
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

  const clearMessages = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { messages, loading, sendMessage, clearMessages };
}
