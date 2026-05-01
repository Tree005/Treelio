// src/components/Profile.jsx — 个人主页（展示品味标签）
import { useState, useEffect } from 'react';

const TASTE_TAGS = [
  'PIANO',
  'NEO-CLASSICAL',
  'AMBIENT',
  'LO-FI',
  'FOCUS',
  'MINIMALISM',
  'SCORE',
  'CHILLOUT',
];

const MOOD_TAGS = [
  'MIDNIGHT',
  'RAINY-DAY',
  'FOCUS',
  'WANDERING',
  'NOSTALGIC',
];

export default function Profile({ theme, onToggleTheme, onClose, player }) {
  const [activeTag, setActiveTag] = useState(null);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetch('/api/profile/stats')
      .then(r => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  function handlePlayTag(tag) {
    const msg = `来一首${tag.replace(/-/g, ' ').toLowerCase()}风格的歌`;
    const input = document.querySelector('.chat__input');
    if (input) {
      input.value = msg;
      input.form?.requestSubmit();
    }
  }

  return (
    <div className="profile">
      <header className="profile__top-bar">
        <button className="profile__back" onClick={onClose} title="返回">
          ←
        </button>
        <span className="profile__top-title">PROFILE</span>
        <button className="theme-toggle" onClick={onToggleTheme}>
          {theme === 'dark' ? 'LIGHT' : 'DARK'}
        </button>
      </header>

      <div className="profile__body">
        <div className="profile__hero">
          <img className="profile__avatar" src="/Treelio.jpg" alt="Treelio" />
          <h1 className="profile__name">TREELIO</h1>
          <p className="profile__tagline">一开机我就打碟</p>
        </div>

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

        <div className="profile__signature">
          TREELIO <span className="profile__sig-x">×</span> AI
        </div>
      </div>
    </div>
  );
}
