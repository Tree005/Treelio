// server/services/weather.js — 和风天气
import fetch from 'node-fetch';
import config from '../config.js';

export async function getWeather(location = '101010100') {
  const key = config.qweather.key;
  const publicId = config.qweather.id; // 商业用户项目ID
  // 商业用户需同时传 publicid + key，免费用户只传 key
  const params = publicId
    ? `location=${location}&publicid=${publicId}&key=${key}`
    : `location=${location}&key=${key}`;
  const url = `https://devapi.qweather.com/v7/weather/now?${params}`;
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
