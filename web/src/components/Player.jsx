// src/components/Player.jsx — 播放器组件（Treelio 风格）
import { useState, useRef, useEffect } from 'react';

export default function Player({
  currentSong,
  playing,
  currentTime,
  duration,
  liked,
  queue,
  queueIndex,
  togglePlay,
  seek,
  toggleLike,
  playNext,
  playPrevious,
  stop,
  formatTime,
}) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const [vol, setVol] = useState(80);
  const songNameRef = useRef(null);
  const animKeyRef = useRef(0);

  const queueLen = queue?.length || 0;
  const queuePos = queueIndex >= 0 ? queueIndex + 1 : 0;

  // 切歌时重置滚动动画
  useEffect(() => {
    animKeyRef.current += 1;
  }, [currentSong]);

  // 检测歌名是否溢出
  useEffect(() => {
    const el = songNameRef.current;
    if (!el) return;
    const inner = el.querySelector('.player__song-name-inner');
    if (inner && inner.scrollWidth > el.clientWidth) {
      el.classList.add('player__song-name--scroll');
    } else {
      el.classList.remove('player__song-name--scroll');
    }
  }, [currentSong]);

  function handleProgressClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seek(Math.max(0, Math.min(1, ratio)));
  }

  function handleVolClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    setVol(Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100))));
  }

  return (
    <>
      {/* 主行：频谱 + 歌曲信息 + 控制按钮 + 标签 + 音量 */}
      <div className="player__main-row">
        {/* 左侧：频谱 */}
        <div className={`player__wave ${playing ? '' : 'player__wave--idle'}`}>
          <div className="player__wave-bar" />
          <div className="player__wave-bar" />
          <div className="player__wave-bar" />
          <div className="player__wave-bar" />
        </div>

        {/* 歌曲信息 */}
        <div className="player__song-info">
          <div className={`player__song-name${playing ? '' : ' player__song-name--pause'}`} ref={songNameRef}>
            <span className="player__song-name-inner" key={animKeyRef.current}>
              {currentSong ? `${currentSong.name} - ${currentSong.artist}` : 'Treelio'}
            </span>
          </div>
          <div className="player__song-status">
            {currentSong ? (playing ? 'PLAYING' : 'PAUSED') : 'READY'}
          </div>
        </div>

        {/* 控制按钮组 */}
        <div className="player__controls">
          <button className="player__btn player__btn--circle" onClick={playPrevious} title="上一首" disabled={queueLen === 0}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 3h2v10H3V3zm10 0L6 8l7 5V3z"/>
            </svg>
          </button>
          <button className="player__btn player__btn--circle" onClick={togglePlay} title={playing ? '暂停' : '播放'}>
            {playing ? (
              <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor">
                <path d="M2 1h4v12H2V1zm6 0h4v12H8V1z"/>
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor">
                <path d="M2 1l10 6-10 6V1z"/>
              </svg>
            )}
          </button>
          <button className="player__btn player__btn--circle" onClick={playNext} title="下一首" disabled={queueLen <= 1}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11 3h2v10h-2V3zM3 3l7 5-7 5V3z"/>
            </svg>
          </button>
          <button className="player__btn player__btn--circle" onClick={stop} title="停止" disabled={queueLen === 0}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 3h10v10H3V3z"/>
            </svg>
          </button>
          <button
            className={`player__btn player__btn--circle ${liked ? 'player__btn--active' : ''}`}
            onClick={toggleLike}
            title={liked ? '取消收藏' : '收藏'}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5">
              <path d="M8 14s-6-4-6-8.5C2 3 3.8 1.5 5.5 1.5c1.1 0 2 .6 2.5 1.3.5-.7 1.4-1.3 2.5-1.3C12.2 1.5 14 3 14 5.5 14 10 8 14 8 14z"/>
            </svg>
          </button>
        </div>

        {/* 标签组 */}
        <div className="player__tags">
          <span className={`player__tag ${liked ? 'player__tag--active' : ''}`}>FAV</span>
          <span className="player__tag">VOL</span>
        </div>

        {/* 音量滑块 */}
        <div className="player__vol-slider" onClick={handleVolClick}>
          <div className="player__vol-track">
            <div className="player__vol-fill" style={{ width: `${vol}%` }} />
            <div className="player__vol-thumb" style={{ left: `${vol}%` }} />
          </div>
        </div>
      </div>

      {/* 底部行：时间 + 进度条 */}
      <div className="player__progress-row">
        <span className="player__time">{formatTime(currentTime)}</span>
        <div className="player__progress-bar" onClick={handleProgressClick}>
          <div className="player__progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="player__time">{formatTime(duration)}</span>
      </div>

      {/* 队列信息 */}
      {queueLen > 0 && (
        <div className="player__queue-info">
          QUEUE {queuePos}/{queueLen}
        </div>
      )}
    </>
  );
}
