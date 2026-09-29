'use strict';

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.resolve(
  process.cwd(),
  process.env.DATA_FILE || 'data/news-history.json'
);

const MAX_HISTORY = Number(process.env.MAX_HISTORY_ITEMS || 5000);

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ items: [] }, null, 2), 'utf8');
  }
}

function loadHistory() {
  ensureDataFile();
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  } catch (error) {
    console.error('خطا در خواندن تاریخچه:', error.message);
    return [];
  }
}

function value(item, key) {
  return item && typeof item === 'object'
    ? String(item[key] || '').trim()
    : '';
}

function normalize(item) {
  if (!item) return null;
  if (typeof item === 'string' || typeof item === 'number') {
    return { id: String(item) };
  }

  return {
    id: value(item, 'id'),
    hash: value(item, 'hash'),
    url: value(item, 'url') || value(item, 'link'),
    title: value(item, 'title'),
    content: value(item, 'content') || value(item, 'description') || value(item, 'text'),
    publishedAt: value(item, 'publishedAt'),
    source: value(item, 'source')
  };
}

function normalizeText(text) {
  return String(text || '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ۀة]/g, 'ه')
    .replace(/[إأ]/g, 'ا')
    .replace(/\u200c/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/www\.\S+/gi, ' ')
    .replace(/@[A-Za-z0-9_]{4,64}/g, ' ')
    .replace(/#[A-Za-z0-9_\u0600-\u06ff]+/g, ' ')
    .replace(/[^\u0600-\u06ffa-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function similarity(a, b) {
  const aa = normalizeText(a);
  const bb = normalizeText(b);

  if (!aa || !bb) return 0;
  if (aa === bb) return 1;

  const wordsA = new Set(aa.split(' ').filter(Boolean));
  const wordsB = new Set(bb.split(' ').filter(Boolean));

  let common = 0;
  wordsA.forEach(word => {
    if (wordsB.has(word)) common++;
  });

  const union = new Set(
    Array.from(wordsA).concat(Array.from(wordsB))
  ).size;

  return union ? common / union : 0;
}

function isSameNews(item, oldItem) {
  const current = normalize(item);
  const old = normalize(oldItem);

  if (!current || !old) return false;

  if (current.hash && old.hash && current.hash === old.hash) return true;
  if (current.url && old.url && current.url === old.url) return true;
  if (current.id && old.id && current.id === old.id) return true;

  // خبرهای منتشرشده توسط دو منبع مختلف با URL متفاوت:
  // اگر تیتر تقریباً یکسان باشد، همان خبر است.
  if (
    current.title &&
    old.title &&
    similarity(current.title, old.title) >= 0.82
  ) {
    return true;
  }

  // اگر تیتر کمی تغییر کرده ولی متن خبر تقریباً همان باشد.
  if (
    current.content &&
    old.content &&
    similarity(current.content, old.content) >= 0.86
  ) {
    return true;
  }

  return false;
}

function hasNews(item) {
  if (!item) return false;
  return loadHistory().some(entry => isSameNews(item, entry));
}

function saveNews(item) {
  if (!item) return;

  const history = loadHistory();
  const current = normalize(item);
  if (!current) return;

  if (history.some(entry => isSameNews(current, entry))) return;

  history.push(current);

  ensureDataFile();
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({ items: history.slice(-MAX_HISTORY) }, null, 2),
    'utf8'
  );
}

module.exports = {
  loadHistory,
  hasNews,
  saveNews
};
