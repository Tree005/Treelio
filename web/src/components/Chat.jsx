// src/components/Chat.jsx — 聊天区域
import { useRef, useEffect } from 'react';

function formatMsgTime(date) {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function MessageBubble({ msg, onPlaySong }) {
  const isUser = msg.role === 'user';
  const avatarEl = isUser ? (
    <img className="message__avatar" src="/avatar-user.jpg" alt="User" />
  ) : (
    <div className="message__avatar message__avatar--claudio">T</div>
  );

  return (
    <div className={`message message--${isUser ? 'user' : 'claudio'}`}>
      {avatarEl}
      <div className="message__body">
        <div className="message__bubble">
          {msg.content}
          {msg.songs?.length > 0 && (
            <div>
              {msg.songs.map((song, i) => (
                <div key={i} className="song-card" onClick={() => onPlaySong(song)}>
                  <div className="song-card__play">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                      <path d="M1 1l8 5-8 5V1z"/>
                    </svg>
                  </div>
                  <div className="song-card__info">
                    <div className="song-card__name">{song.name}</div>
                    <div className="song-card__artist">{song.artist}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <span className="message__time">{formatMsgTime(msg.time)}</span>
      </div>
    </div>
  );
}

export default function Chat({ messages, loading, onSend }) {
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
          <span className="chat__dj-name">Treelio</span>
          <span className="chat__live">LIVE</span>
        </div>
        <span className="chat__status">Connected to Treelio server</span>
      </div>

      {/* 消息列表 */}
      <div className="chat__messages">
        {messages.length === 0 && !loading && (
          <div className="now-playing">Say something to the DJ...</div>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} onPlaySong={onSend} />
        ))}
        {loading && (
          <div className="message message--claudio">
            <div className="message__avatar message__avatar--claudio">T</div>
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
