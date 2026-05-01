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
      <header className="top-bar">
        <div className="top-bar__logo" onClick={() => setShowProfile(true)} style={{ cursor: 'pointer' }}>
          <img className="top-bar__avatar" src="/Treelio.jpg" alt="Treelio" />
          <span>Treelio</span>
        </div>
        <div className="top-bar__actions">
          <button className="top-bar__login">LOGIN</button>
          <div className="theme-pills">
            {['daily', 'dark', 'light'].map(t => (
              <button
                key={t}
                className={`theme-pill${theme === t ? ' theme-pill--active' : ''}`}
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

      {/* 底栏 */}
      <footer className="footer">
        <span>TREELIO FM</span>
        <span className="footer__status">CONNECTED</span>
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
