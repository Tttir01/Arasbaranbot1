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
      'Mozilla/5.0 ArasbaranNewsBot/2.0'
  }
});

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
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

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

async function fetchSource(source) {
  console.log('');
  console.log('--------------------------------');
  console.log(`در حال بررسی منبع: ${source.name}`);
  console.log(`URL: ${source.url}`);

  try {
    const feed = await parser.parseURL(
      source.url
    );

    const items = Array.isArray(feed.items)
      ? feed.items
      : [];

    console.log(
      `تعداد آیتم RSS: ${items.length}`
    );

    const news = items
      .slice(
        0,
        CONFIG.news.maxItemsPerSource
      )
      .map(item =>
        normalizeItem(item, source)
      )
      .filter(item => item.title);

    console.log(
      `تعداد خبر معتبر: ${news.length}`
    );

    if (news.length > 0) {
      console.log(
        `اولین خبر: ${news[0].title}`
      );
    }

    return news;

  } catch (error) {
    console.error(
      `❌ خطا در منبع ${source.name}`
    );

    console.error(
      error.message
    );

    return [];
  }
}

async function fetchAllNews() {
  console.log('');
  console.log('================================');
  console.log('شروع دریافت اخبار');
  console.log('================================');

  const sources =
    getGoogleNewsSources();

  console.log(
    `تعداد منابع فعال: ${sources.length}`
  );

  const allNews = [];

  for (const source of sources) {
    const news =
      await fetchSource(source);

    allNews.push(...news);
  }

  console.log('');
  console.log('================================');
  console.log(
    `مجموع اخبار دریافت‌شده: ${allNews.length}`
  );
  console.log('================================');

  return allNews;
}

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

function sortByDate(items) {
  return [...items].sort((a, b) => {
    const dateA =
      new Date(a.publishedAt).getTime() || 0;

    const dateB =
      new Date(b.publishedAt).getTime() || 0;

    return dateB - dateA;
  });
}

function limitNews(items, maxItems) {
  const limit =
    Number(maxItems) > 0
      ? Number(maxItems)
      : CONFIG.news.maxTotalItems;

  return items.slice(0, limit);
}

async function collectNews() {
  const news =
    await fetchAllNews();

  const uniqueNews =
    removeDuplicates(news);

  const sortedNews =
    sortByDate(uniqueNews);

  return limitNews(
    sortedNews,
    CONFIG.news.maxTotalItems
  );
}

async function fetchNewsByArea(area) {
  const sources =
    getGoogleNewsSources().filter(
      source => {
        if (!Array.isArray(source.areas)) {
          return false;
        }

        return source.areas.includes(area);
      }
    );

  const results = [];

  for (const source of sources) {
    const news =
      await fetchSource(source);

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
