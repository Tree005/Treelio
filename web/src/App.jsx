// src/App.jsx — 根组件
import { useState, useEffect } from 'react';
import { useTheme } from './hooks/useTheme';
import { usePlayer } from './hooks/usePlayer';
import { useChat } from './hooks/useChat';
import PixelClock from './components/PixelClock';
import Player from './components/Player';
import Chat from './components/Chat';
import Profile from './components/Profile';

export default function App() {
  const [showProfile, setShowProfile] = useState(false);
  const { theme, switchTheme } = useTheme();
  const player = usePlayer();
  const { messages, loading, sendMessage } = useChat(player.play, player.enqueueAndPlay);

  // 播放时给卡片加 playing 类，触发点阵呼吸动画
  useEffect(() => {
    const card = document.querySelector('.app__card');
    if (!card) return;
    if (player.playing) {
      card.classList.add('playing');
    } else {
      card.classList.remove('playing');
    }
    return () => { if (card) card.classList.remove('playing'); };
  }, [player.playing]);

  return (
    <div className="app">
      {/* 顶栏 */}
      <header className="header">
        <div className="brand" onClick={() => setShowProfile(true)} style={{ cursor: 'pointer' }}>
          <img className="brand__avatar" src="/Treelio.jpg" alt="Treelio" />
          T<span className="brand__highlight">r</span>eelio
        </div>
        <div className="header-actions">
          <button className="btn-login">LOGIN</button>
          <div className="theme-toggles">
            {['daily', 'dark', 'light'].map(t => (
              <button
                key={t}
                className={`theme-btn${theme === t ? ' theme-btn--active' : ''}`}
                onClick={() => switchTheme(t)}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* 主内容卡片容器 */}
      <div className="app__card">
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
      </div>

      {/* 底栏 — 连接状态 */}
      <footer className="connection-row">
        <div className="conn-left">
          <span className="conn-artist">Treelio</span>
          <span className="badge-live">LIVE</span>
        </div>
        <div className="conn-middle">
          <span>Connect</span>
          <span className="conn-dot-sep"></span>
          <span>io server</span>
        </div>
        <div className="conn-status">
          <span className="conn-dot-green"></span>
          CONNECTED
        </div>
      </footer>

      {/* Profile 弹出层 */}
      {showProfile && (
        <>
          <div className="profile-overlay" onClick={() => setShowProfile(false)} />
          <Profile
            theme={theme}
            onToggleTheme={() => switchTheme(theme === 'dark' ? 'daily' : 'dark')}
            onClose={() => setShowProfile(false)}
            player={player}
          />
        </>
      )}
    </div>
  );
}
