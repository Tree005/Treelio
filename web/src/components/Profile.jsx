// src/components/Profile.jsx — 个人主页（展示品味标签）
import { useState, useEffect } from 'react';

const TASTE_TAGS = [
  'JAZZ-HIPHOP',
  'NEO-CLASSICAL',
  'LO-FI',
  'CHILLWAVE',
  'POST-ROCK',
  'SYNTHWAVE',
  'AMBIENT',
  'DOWNTEMPO',
];

const MOOD_TAGS = [
  'MIDNIGHT',
  'RAINY-DAY',
  'FOCUS',
  'WANDERING',
  'NSTALGIC',
];

export default function Profile({ theme, onToggleTheme, onBack, player }) {
  const [activeTag, setActiveTag] = useState(null);
  const [stats, setStats] = useState(null);
  const avatarRef = useRef(null);

  useEffect(() => {
    // 从后端获取听歌统计数据
    fetch('/api/profile/stats')
      .then(r => r.json())
      .catch(() => null)
      .then(data => {
        if (data) setStats(data);
      });
  }, []);

  function handlePlayTag(tag) {
    if (!player) return;
    // 告诉 AI 播放这个风格的歌
    const msg = `来一首${tag.replace(/-/g, ' ').toLowerCase()}风格的歌`;
    if (player.insertAndPlay) {
      // 触发聊天发送
      const input = document.querySelector('.chat__input');
      if (input) {
        input.value = msg;
        input.form?.requestSubmit();
      }
    }
  }

  return (
    <div className="profile">
      {/* 顶部导航 */}
      <header className="profile__top-bar">
        <button className="profile__back" onClick={onBack} title="返回">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 3L5 8l5 5"/>
          </svg>
        </button>
        <span className="profile__top-title">PROFILE</span>
        <button className="theme-toggle" onClick={onToggleTheme}>
          {theme === 'dark' ? 'LIGHT' : 'DARK'}
        </button>
      </header>

      {/* 主体（可滚动） */}
      <div className="profile__body">
        {/* 头像 + 名字 */}
        <div className="profile__hero">
          <div className="profile__avatar-wrap">
            <img
              className="profile__avatar"
              src="/Treelio.jpg"
              alt="Treelio"
            />
            <div className="profile__avatar-ring" />
          </div>
          <h1 className="profile__name">TREELIO</h1>
          <p className="profile__tagline">一开机我就打碟</p>
        </div>

        {/* 统计 */}
        <div className="profile__stats">
          <div className="profile__stat">
            <span className="profile__stat-num">{stats?.totalSongs ?? '--'}</span>
            <span className="profile__stat-label">SONGS PLAYED</span>
          </div>
          <div className="profile__stat">
            <span className="profile__stat-num">{stats?.totalArtists ?? '--'}</span>
            <span className="profile__stat-label">ARTISTS</span>
          </div>
          <div className="profile__stat">
            <span className="profile__stat-num">{stats?.totalHours ?? '--'}</span>
            <span className="profile__stat-label">HOURS</span>
          </div>
        </div>

        {/* 品味标签区 */}
        <section className="profile__section">
          <h2 className="profile__section-title">TASTE</h2>
          <div className="profile__tags">
            {TASTE_TAGS.map(tag => (
              <button
                key={tag}
                className={`profile__tag${activeTag === tag ? ' profile__tag--active' : ''}`}
                onClick={() => { setActiveTag(tag); handlePlayTag(tag); }}
              >
                {tag}
              </button>
            ))}
          </div>
        </section>

        {/* 心情标签区 */}
        <section className="profile__section">
          <h2 className="profile__section-title">MOODS</h2>
          <div className="profile__tags">
            {MOOD_TAGS.map(tag => (
              <button
                key={tag}
                className={`profile__tag profile__tag--mood${activeTag === tag ? ' profile__tag--active' : ''}`}
                onClick={() => { setActiveTag(tag); handlePlayTag(tag); }}
              >
                {tag}
              </button>
            ))}
          </div>
        </section>

        {/* 底部署名 */}
        <div className="profile__signature">
          TREELIO <span className="profile__sig-x">×</span> AI
        </div>
      </div>
    </div>
  );
}
