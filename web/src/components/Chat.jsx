// src/components/Chat.jsx — 聊天区域
import { useRef, useEffect } from 'react';

function formatMsgTime(date) {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function MessageBubble({ msg, onPlaySong, onAddToQueue }) {
  const isUser = msg.role === 'user';
  const avatarEl = isUser ? (
    <img className="message__avatar" src="/avatar-user.jpg" alt="User" />
  ) : (
    <img className="message__avatar" src="/Treelio.jpg" alt="Treelio" />
  );

  function handleSongClick(e, song) {
    // 点击 "+" 按钮 → 入队，否则直接播放
    if (e.target.closest('.song-card__add')) {
      e.stopPropagation();
      onAddToQueue?.(song);
      return;
    }
    onPlaySong(song);
  }

  return (
    <div className={`message message--${isUser ? 'user' : 'treelio'}`}>
      {avatarEl}
      <div className="message__body">
        <div className="message__bubble">
          {msg.content}
          {msg.songs?.length > 0 && (
            <div className="message__songs">
              {msg.songs.map((song, i) => (
                <div key={i} className="song-card" onClick={(e) => handleSongClick(e, song)}>
                  <div className="song-card__cover">
                    {song.coverUrl ? (
                      <img src={song.coverUrl} alt="" className="song-card__cover-img" />
                    ) : (
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M1 1l8 5-8 5V1z"/>
                      </svg>
                    )}
                  </div>
                  <div className="song-card__info">
                    <div className="song-card__name">{song.name}</div>
                    <div className="song-card__artist">{song.artist}</div>
                  </div>
                  <button
                    className="song-card__add"
                    onClick={(e) => handleSongClick(e, song)}
                    title="添加到队列"
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
                      <path d="M6 1v10M1 6h10"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="message__meta">
          <span className="message__time">{formatMsgTime(msg.time)}</span>
          {!isUser && (
            <span className="message__replay">REPLAY</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Chat({ messages, loading, onSend, onPlaySong, onAddToQueue }) {
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function handleSubmit(e) {
    e.preventDefault();
    const input = inputRef.current;
    if (!input.value.trim()) return;
    onSend(input.value);
    input.value = '';
    input.focus();
  }

  return (
    <>
      {/* 聊天头部 */}
      <div className="chat__header">
        <div className="chat__header-left">
          <span className="chat__dj-dot" />
          <span className="chat__dj-name">Treelio</span>
          <span className="chat__live">LIVE</span>
        </div>
        <span className="chat__status">Connected to Treelio server</span>
      </div>

      {/* 消息列表 */}
      <div className="chat__messages">
        {messages.length === 0 && !loading && (
          <div className="chat__empty">Say something to the DJ...</div>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} onPlaySong={onPlaySong} onAddToQueue={onAddToQueue} />
        ))}
        {loading && (
          <div className="message message--treelio">
            <img className="message__avatar" src="/Treelio.jpg" alt="Treelio" />
            <div className="message__body">
              <div className="message__bubble">
                <div className="typing-indicator">
                  <div className="typing-indicator__dot" />
                  <div className="typing-indicator__dot" />
                  <div className="typing-indicator__dot" />
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="chat__input-area">
        <form className="chat__input-wrap" onSubmit={handleSubmit}>
          <input
            className="chat__input"
            ref={inputRef}
            placeholder="Say something to the DJ..."
            disabled={loading}
          />
          <button className="chat__mic" type="button" disabled>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM5 7H3a5 5 0 0 0 10 0h-2a3 3 0 0 1-6 0zm3 6v2M6 15h4"/>
            </svg>
          </button>
          <button className="chat__send" type="submit" disabled={loading}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 1l14 7-14 7V9l10-1-10-1V1z"/>
            </svg>
          </button>
        </form>
      </div>
    </>
  );
}
