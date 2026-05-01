// src/components/Player.jsx — 播放器组件（Treelio 风格）
import { useState, useRef, useEffect } from 'react';
import Queue from './Queue';
import './Queue.css';

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
  const [muted, setMuted] = useState(false);
  const songNameRef = useRef(null);
  const animKeyRef = useRef(0);
  const progressBarRef = useRef(null);

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

  function handleProgressDrag(e) {
    const rect = progressBarRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const ratio = (clientX - rect.left) / rect.width;
    seek(Math.max(0, Math.min(1, ratio)));
  }

  return (
    <>
      {/* 第一行：歌曲信息 + 辅助按钮 */}
      <div className="player__row player__row--info">
        <div className="player__song-meta">
          <span className="player__song-name" ref={songNameRef}>
            <span className="player__song-name-inner" key={animKeyRef.current}>
              {currentSong ? `${currentSong.name} — ${currentSong.artist}` : 'Treelio'}
            </span>
          </span>
          <span className={`player__badge ${playing ? 'player__badge--playing' : 'player__badge--paused'}`}>
            {currentSong ? (playing ? 'PLAYING' : 'PAUSED') : 'READY'}
          </span>
        </div>
        <div className="player__aux-btns">
          <button className="player__btn player__btn--pill" title="隐藏播放器">HIDE</button>
          <button
            className={`player__btn player__btn--pill ${liked ? 'player__btn--liked' : ''}`}
            onClick={toggleLike}
            title={liked ? '取消收藏' : '收藏'}
          >
            {liked ? '♥' : 'FAV'}
          </button>
          <button
            className={`player__btn player__btn--pill ${muted ? 'player__btn--muted' : ''}`}
            onClick={() => setMuted(!muted)}
            title={muted ? '取消静音' : '静音'}
          >
            {muted ? 'MUTE' : 'VOL'}
          </button>
        </div>
      </div>

      {/* 第二行：进度条 + 时间（时间在进度条下方） */}
      <div className="player__row player__row--progress">
        <div className="player__progress-container">
          <div
            className="player__progress-wrap"
            ref={progressBarRef}
            onClick={handleProgressClick}
            onMouseMove={(e) => e.buttons === 1 && handleProgressDrag(e)}
            onTouchMove={handleProgressDrag}
          >
            <div className="player__progress-track">
              <div className="player__progress-fill" style={{ width: `${progress}%` }} />
              <div className="player__progress-thumb" style={{ left: `${progress}%` }} />
            </div>
          </div>
          <div className="player__time-row">
            <span className="player__time">{formatTime(currentTime)}</span>
            <span className="player__time">{formatTime(duration)}</span>
          </div>
        </div>
      </div>

      {/* 第三行：控制按钮 + QUEUE */}
      <div className="player__row player__row--controls">
        <div className="player__controls">
          <button className="player__btn player__btn--pill" onClick={playPrevious} title="上一首" disabled={queueLen === 0}>
            ◀ PREV
          </button>
          <button
            className="player__btn player__btn--pill player__btn--play"
            onClick={togglePlay}
            title={playing ? '暂停' : '播放'}
            disabled={!currentSong}
          >
            {playing ? '❚❚ PAUSE' : '▶ PLAY'}
          </button>
          <button className="player__btn player__btn--pill" onClick={playNext} title="下一首" disabled={queueLen <= 1}>
            NEXT ▶
          </button>
          <button className="player__btn player__btn--pill" onClick={stop} title="停止" disabled={queueLen === 0}>
            ■ END
          </button>
        </div>
        <Queue />
      </div>
    </>
  );
}
