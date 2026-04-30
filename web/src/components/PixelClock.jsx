// src/components/PixelClock.jsx — 像素风时钟
import { useState, useEffect } from 'react';

export default function PixelClock() {
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

  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <>
      <div className="clock-time">{timeStr}</div>
      <div className="clock-date">
        {weekday}
        <br />
        {dateStr}
      </div>
      <div className="on-air">
        <span className="on-air__dot" />
        ON AIR
      </div>
    </>
  );
}
