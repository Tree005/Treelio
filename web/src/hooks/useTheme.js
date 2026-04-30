// src/hooks/useTheme.js — 主题切换
import { useState, useEffect, useCallback } from 'react';

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('treelio-theme');
    return saved || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('treelio-theme', theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme(t => t === 'dark' ? 'light' : 'dark');
  }, []);

  return { theme, toggle };
}
