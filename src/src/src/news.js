'use strict';

const Parser = require('rss-parser');
const crypto = require('crypto');

const { getConfig } = require('./config');
const { getGoogleNewsSources } = require('./sources');

const CONFIG = getConfig();

const parser = new Parser({
  timeout: CONFIG.news.requestTimeout,

  headers: {
    'User-Agent':
      'Mozilla/5.0 ArasbaranNewsBot/1.0'
  }
});

/**
 * ساخت شناسه یکتا برای خبر
 */
function createNewsId(item) {
  const base = [
    item.title || '',
    item.link || '',
    item.publishedAt || ''
  ].join('|');

  return crypto
    .createHash('sha256')
    .update(base)
    .digest('hex')
    .substring(0, 32);
}

/**
 * پاک کردن HTML
 */
function stripHtml(text) {
  if (!text) {
    return '';
  }

  return String(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * استخراج نام منبع از RSS
 */
function extractSourceName(item, source) {
  if (item.creator) {
    return stripHtml(item.creator);
  }

  if (item.author) {
    return stripHtml(item.author);
  }

  if (item['dc:creator']) {
    return stripHtml(item['dc:creator']);
  }

  if (source && source.name) {
    return source.name;
  }

  return 'منبع خبری';
}

/**
 * تبدیل یک آیتم RSS به ساختار استاندارد خبر
 */
function normalizeItem(item, source) {
  const title = stripHtml(item.title || '');

  const description = stripHtml(
    item.contentSnippet ||
    item.content ||
    item.description ||
    ''
  );

  const link = item.link || '';

  const publishedAt =
    item.isoDate ||
    item.pubDate ||
    new Date().toISOString();

  const sourceName =
    extractSourceName(item, source);

  const id = createNewsId({
    title,
    link,
    publishedAt
  });

  return {
    id,
    title,
    description,
    link,
    publishedAt,
    sourceName,
    sourceId: source.id,
    sourceType: source.type,
    areas: Array.isArray(source.areas)
      ? source.areas
      : []
  };
}

/**
 * دریافت اخبار یک منبع
 */
async function fetchSource(source) {
  try {
    const feed = await parser.parseURL(source.url);

    const items = Array.isArray(feed.items)
      ? feed.items
      : [];

    return items
      .slice(0, CONFIG.news.maxItemsPerSource)
      .map(item =>
        normalizeItem(item, source)
      )
      .filter(item => item.title);

  } catch (error) {
    console.error(
      `خطا در دریافت منبع ${source.name}:`,
      error.message
    );

    return [];
  }
}

/**
 * دریافت اخبار تمام منابع فعال
 */
async function fetchAllNews() {
  const sources = getGoogleNewsSources();

  const allNews = [];

  for (const source of sources) {
    const news = await fetchSource(source);

    allNews.push(...news);
  }

  return allNews;
}

/**
 * حذف اخبار تکراری
 */
function removeDuplicates(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    if (!item || !item.id) {
      continue;
    }

    if (seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    result.push(item);
  }

  return result;
}

/**
 * مرتب‌سازی اخبار از جدید به قدیم
 */
function sortByDate(items) {
  return [...items].sort((a, b) => {
    const dateA =
      new Date(a.publishedAt).getTime() || 0;

    const dateB =
      new Date(b.publishedAt).getTime() || 0;

    return dateB - dateA;
  });
}

/**
 * محدود کردن تعداد اخبار
 */
function limitNews(items, maxItems) {
  const limit =
    Number(maxItems) > 0
      ? Number(maxItems)
      : CONFIG.news.maxTotalItems;

  return items.slice(0, limit);
}

/**
 * دریافت، پاک‌سازی و مرتب‌سازی اخبار
 */
async function collectNews() {
  const news = await fetchAllNews();

  const uniqueNews =
    removeDuplicates(news);

  const sortedNews =
    sortByDate(uniqueNews);

  return limitNews(
    sortedNews,
    CONFIG.news.maxTotalItems
  );
}

/**
 * دریافت اخبار یک منطقه خاص
 */
async function fetchNewsByArea(area) {
  const sources =
    getGoogleNewsSources().filter(source => {
      if (!Array.isArray(source.areas)) {
        return false;
      }

      return source.areas.includes(area);
    });

  const results = [];

  for (const source of sources) {
    const news = await fetchSource(source);

    results.push(...news);
  }

  return limitNews(
    sortByDate(
      removeDuplicates(results)
    ),
    CONFIG.news.maxTotalItems
  );
}

module.exports = {
  createNewsId,
  fetchSource,
  fetchAllNews,
  collectNews,
  fetchNewsByArea,
  removeDuplicates,
  sortByDate
};
