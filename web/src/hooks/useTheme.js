// src/hooks/useTheme.js — 主题切换（三值：daily / dark / light）
import { useState, useEffect, useCallback } from 'react';

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('treelio-theme');
    return saved || 'daily';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('treelio-theme', theme);
  }, [theme]);

  const switchTheme = useCallback((t) => setTheme(t), []);

  return { theme, switchTheme };
}
