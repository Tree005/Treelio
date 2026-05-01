// src/components/Queue.jsx — 队列UI组件
import { useState, useEffect, useRef, useCallback } from 'react';
import { usePlayer } from '../hooks/usePlayer';
import './Queue.css';

// 格式化时长
function formatDuration(ms) {
  if (!ms || isNaN(ms)) return '--:--';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

export default function Queue() {
  const { queue, queueIndex, removeFromQueue, jumpToTrack } = usePlayer();
  const [isOpen, setIsOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const dropdownRef = useRef(null);
  const badgeRef = useRef(null);

  // 点击外部关闭面板
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        badgeRef.current &&
        !badgeRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  // 切换面板显示
  const toggleDropdown = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  // 切换到指定曲目
  const handleTrackClick = useCallback((targetIndex) => {
    jumpToTrack(targetIndex);
    setIsOpen(false);
  }, [jumpToTrack]);

  // 移除曲目
  const handleRemove = useCallback((e, index) => {
    e.stopPropagation();

    if (queue.length <= 1) {
      setToast('无法移除最后一首');
      setTimeout(() => setToast(null), 2000);
      return;
    }

    removeFromQueue(index);
  }, [queue.length, removeFromQueue]);

  const queueCount = queue?.length || 0;

  return (
    <>
      {/* 胶囊徽章：QUEUE 5 TRACKS */}
      <button
        ref={badgeRef}
        className={`queue-badge ${isOpen ? 'is-open' : ''}`}
        onClick={toggleDropdown}
        title="查看播放队列"
      >
        <span>QUEUE</span>
        <span className="queue-count">{queueCount}</span>
        <span className="queue-label">TRACKS</span>
      </button>

      {/* 下拉面板 */}
      {isOpen && (
        <div ref={dropdownRef} className="queue-dropdown">
          {/* 曲目列表 */}
          {queueCount > 0 ? (
            <div className="queue-list">
              {queue.map((song, index) => (
                <div
                  key={`${song.id}-${index}`}
                  className={`queue-item ${index === queueIndex ? 'is-current' : ''}`}
                  onClick={() => handleTrackClick(index)}
                >
                  {/* 左侧：音符图标 + 歌曲名 */}
                  <div className="queue-item-left">
                    {index === queueIndex ? (
                      <svg className="queue-item-icon" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                      </svg>
                    ) : null}
                    <span className="queue-item-name" title={song.name}>
                      {song.name}
                    </span>
                  </div>

                  {/* 右侧：时长 + X按钮 */}
                  <div className="queue-item-right">
                    <span className="queue-item-duration">
                      {song.duration ? formatDuration(song.duration) : '--:--'}
                    </span>
                    <button
                      className="queue-item-remove"
                      onClick={(e) => handleRemove(e, index)}
                      title="移除"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="queue-empty">
              <span className="queue-empty-text">队列为空</span>
            </div>
          )}
        </div>
      )}

      {/* Toast 提示 */}
      {toast && (
        <div className="queue-toast">
          {toast}
        </div>
      )}
    </>
  );
}
