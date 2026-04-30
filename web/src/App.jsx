// src/App.jsx — 根组件
import { useState } from 'react';
import { useTheme } from './hooks/useTheme';
import { usePlayer } from './hooks/usePlayer';
import { useChat } from './hooks/useChat';
import PixelClock from './components/PixelClock';
import Player from './components/Player';
import Chat from './components/Chat';
import Profile from './components/Profile';

export default function App() {
  const [view, setView] = useState('main'); // 'main' | 'profile'
  const { theme, toggle } = useTheme();
  const player = usePlayer();
  const { messages, loading, sendMessage } = useChat(player.play, player.enqueueAndPlay);

  if (view === 'profile') {
    return <Profile theme={theme} onToggleTheme={toggle} onBack={() => setView('main')} player={player} />;
  }

  return (
    <div className="app">
      {/* 顶栏 */}
      <header className="top-bar">
        <div className="top-bar__logo" onClick={() => setView('profile')} style={{ cursor: 'pointer' }}>
          <img className="top-bar__avatar" src="/Treelio.jpg" alt="Treelio" />
          <span>Treelio</span>
        </div>
        <div className="top-bar__actions">
          <button className="top-bar__login">LOGIN</button>
          <button className="theme-toggle" onClick={toggle}>
            {theme === 'dark' ? 'LIGHT' : 'DARK'}
          </button>
        </div>
      </header>

      {/* 时钟区域（带点阵背景） */}
      <section className="clock-section">
        <PixelClock playing={player.playing} />
      </section>

      {/* 播放器条 */}
      <section className="player">
        <Player {...player} />
      </section>

      {/* 聊天区 */}
      <section className="chat">
        <Chat
          messages={messages}
          loading={loading}
          onSend={sendMessage}
          onPlaySong={player.insertAndPlay}
          onAddToQueue={player.addToQueue}
        />
      </section>

      {/* 底栏 */}
      <footer className="footer">
        <span>TREELIO FM</span>
        <span className="footer__status">CONNECTED</span>
      </footer>
    </div>
  );
}
