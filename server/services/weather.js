// server/services/weather.js — 和风天气
import fetch from 'node-fetch';
import config from '../config.js';

export async function getWeather(location = '101010100') {
  // 默认北京，location 为和风城市 ID
  const url = `https://devapi.qweather.com/v7/weather/now?location=${location}&key=${config.qweather.key}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== '200') return null;
    const now = data.now;
    return `${now.text} ${now.temp}°C`;
  } catch {
    return null;
  }
}
