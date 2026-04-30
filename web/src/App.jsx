// src/App.jsx — 根组件
import { useTheme } from './hooks/useTheme';
import { usePlayer } from './hooks/usePlayer';
import { useChat } from './hooks/useChat';
import PixelClock from './components/PixelClock';
import Player from './components/Player';
import Chat from './components/Chat';

export default function App() {
  const { theme, toggle } = useTheme();
  const player = usePlayer();
  const { messages, loading, sendMessage } = useChat(player.play);

  return (
    <div className="app">
      {/* 顶栏 */}
      <header className="top-bar">
        <div className="top-bar__logo">
          <svg className="top-bar__logo-icon" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="10" cy="10" r="3" fill="currentColor"/>
            <circle cx="10" cy="10" r="5" fill="currentColor" opacity="0.2"/>
          </svg>
          <span>TREELIO</span>
        </div>
        <div className="top-bar__actions">
          <button className="theme-toggle" onClick={toggle}>
            {theme === 'dark' ? 'LIGHT' : 'DARK'}
          </button>
        </div>
      </header>

      {/* 时钟 */}
      <section className="clock-section">
        <PixelClock />
      </section>

      {/* 播放器 */}
      <section className="player">
        <Player {...player} />
      </section>

      {/* 聊天 */}
      <section className="chat">
        <Chat messages={messages} loading={loading} onSend={sendMessage} />
      </section>

      {/* 底栏 */}
      <footer className="footer">
        <span>TREELIO FM</span>
        <span className="footer__status">CONNECTED</span>
      </footer>
    </div>
  );
}
