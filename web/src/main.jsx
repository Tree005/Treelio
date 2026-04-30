// src/main.jsx — React 入口
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';

createRoot(document.getElementById('root')).render(<App />);
