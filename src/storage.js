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
    publishedAt: value(item, 'publishedAt'),
    source: value(item, 'source')
  };
}

function normalizeTitle(value) {
  return String(value || '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200c\s]+/g, ' ')
    .replace(/[«»"“”'،,:؛.!؟()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function similarity(a, b) {
  const aa = normalizeTitle(a);
  const bb = normalizeTitle(b);
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

  return !!(
    current.title &&
    old.title &&
    similarity(current.title, old.title) >= 0.88
  );
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
