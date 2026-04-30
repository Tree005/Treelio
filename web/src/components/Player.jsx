// src/components/Player.jsx — 播放器组件
export default function Player({
  currentSong,
  playing,
  currentTime,
  duration,
  liked,
  togglePlay,
  seek,
  toggleLike,
  formatTime,
}) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  function handleProgressClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seek(Math.max(0, Math.min(1, ratio)));
  }

  return (
    <div className="player__card">
      {/* 状态栏 */}
      <div className="player__status">
        <div className={`player__wave ${playing ? '' : 'player__wave--idle'}`}>
          <div className="player__wave-bar" />
          <div className="player__wave-bar" />
          <div className="player__wave-bar" />
          <div className="player__wave-bar" />
          <div className="player__wave-bar" />
        </div>
        <div className="player__song-info">
          <div className="player__song-name">
            {currentSong ? `${currentSong.name} - ${currentSong.artist}` : 'Claudio FM'}
          </div>
          {currentSong && (
            <div className="player__song-artist">{currentSong.album || ''}</div>
          )}
        </div>
        <div className="player__state">{currentSong ? (playing ? 'PLAYING' : 'PAUSED') : 'READY'}</div>
      </div>

      {/* 进度条 */}
      <div className="player__progress">
        <div className="player__progress-bar" onClick={handleProgressClick}>
          <div className="player__progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="player__times">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* 控制按钮 */}
      <div className="player__controls">
        {/* 上一首（暂时无队列，仅占位） */}
        <button className="player__btn" title="上一首">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3 3h2v10H3V3zm10 0L6 8l7 5V3z"/>
          </svg>
        </button>

        {/* 播放/暂停 */}
        <button className="player__btn player__btn--play" onClick={togglePlay} title={playing ? '暂停' : '播放'}>
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M2 1h4v12H2V1zm6 0h4v12H8V1z"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M2 1l10 6-10 6V1z"/>
            </svg>
          )}
        </button>

        {/* 下一首（暂时无队列，仅占位） */}
        <button className="player__btn" title="下一首">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11 3h2v10h-2V3zM3 3l7 5-7 5V3z"/>
          </svg>
        </button>

        {/* 收藏 */}
        <button
          className={`player__btn ${liked ? 'player__btn--active' : ''}`}
          onClick={toggleLike}
          title={liked ? '取消收藏' : '收藏'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5">
            <path d="M8 14s-6-4-6-8.5C2 3 3.8 1.5 5.5 1.5c1.1 0 2 .6 2.5 1.3.5-.7 1.4-1.3 2.5-1.3C12.2 1.5 14 3 14 5.5 14 10 8 14 8 14z"/>
          </svg>
        </button>

        {/* 音量（占位） */}
        <button className="player__btn" title="音量">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 5.5h2.5L7 3v10l-3.5-2.5H1v-5zm10.5 1.5c.8-.8.8-2 0-2.8M11 8c.3-.3.3-.8 0-1"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
