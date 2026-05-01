// src/components/PixelClock.jsx — 像素风时钟
import { useState, useEffect } from 'react';

export default function PixelClock({ playing = false }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  // 格式: "Monday 20 APR 2026"
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const day = now.getDate();
  const month = now.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const year = now.getFullYear();
  const dateStr = `${weekday} ${day} ${month} ${year}`;

  return (
    <>
      <div className="clock-time">{timeStr}</div>
      <div className="clock-date">{dateStr}</div>
      <div className={`on-air${playing ? ' on-air--active' : ''}`}>
        <span className="on-air__dot" />
        {playing ? 'ON AIR' : 'STANDBY'}
      </div>
    </>
  );
}
