'use strict';

const fs = require('fs');
const path = require('path');

const { getConfig } = require('./config');

const CONFIG = getConfig();

const DATA_FILE = CONFIG.dataFile;

/**
 * اطمینان از وجود پوشه data
 */
function ensureDataDirectory() {
  const directory = path.dirname(DATA_FILE);

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {
      recursive: true
    });
  }
}

/**
 * ساخت فایل تاریخچه در صورت نبودن
 */
function ensureDataFile() {
  ensureDataDirectory();

  if (!fs.existsSync(DATA_FILE)) {
    const initialData = {
      version: 1,
      updatedAt: new Date().toISOString(),
      sentNews: []
    };

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(initialData, null, 2),
      'utf8'
    );
  }
}

/**
 * خواندن تاریخچه
 */
function loadHistory() {
  ensureDataFile();

  try {
    const raw = fs.readFileSync(
      DATA_FILE,
      'utf8'
    );

    const data = JSON.parse(raw);

    if (!data || typeof data !== 'object') {
      throw new Error(
        'ساختار فایل تاریخچه صحیح نیست.'
      );
    }

    if (!Array.isArray(data.sentNews)) {
      data.sentNews = [];
    }

    return data;

  } catch (error) {
    console.error(
      'خطا در خواندن تاریخچه اخبار:',
      error.message
    );

    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      sentNews: []
    };
  }
}

/**
 * ذخیره تاریخچه
 */
function saveHistory(data) {
  ensureDataDirectory();

  const output = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sentNews: Array.isArray(data.sentNews)
      ? data.sentNews
      : []
  };

  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(output, null, 2),
    'utf8'
  );
}

/**
 * بررسی اینکه خبر قبلاً ارسال شده یا نه
 */
function hasBeenSent(newsId) {
  if (!newsId) {
    return false;
  }

  const history = loadHistory();

  return history.sentNews.some(
    item => item.id === newsId
  );
}

/**
 * ثبت خبر ارسال‌شده
 */
function markAsSent(newsItem) {
  if (!newsItem || !newsItem.id) {
    return;
  }

  const history = loadHistory();

  const exists = history.sentNews.some(
    item => item.id === newsItem.id
  );

  if (exists) {
    return;
  }

  history.sentNews.push({
    id: newsItem.id,
    title: newsItem.title || '',
    link: newsItem.link || '',
    sourceName: newsItem.sourceName || '',
    publishedAt:
      newsItem.publishedAt ||
      new Date().toISOString(),
    sentAt: new Date().toISOString()
  });

  /*
   * جلوگیری از بزرگ شدن بیش از حد فایل تاریخچه
   */
  const maxHistory = 5000;

  if (history.sentNews.length > maxHistory) {
    history.sentNews =
      history.sentNews.slice(-maxHistory);
  }

  saveHistory(history);
}

/**
 * ثبت چند خبر ارسال‌شده
 */
function markManyAsSent(newsItems) {
  if (!Array.isArray(newsItems)) {
    return;
  }

  const history = loadHistory();

  for (const newsItem of newsItems) {
    if (!newsItem || !newsItem.id) {
      continue;
    }

    const exists = history.sentNews.some(
      item => item.id === newsItem.id
    );

    if (exists) {
      continue;
    }

    history.sentNews.push({
      id: newsItem.id,
      title: newsItem.title || '',
      link: newsItem.link || '',
      sourceName: newsItem.sourceName || '',
      publishedAt:
        newsItem.publishedAt ||
        new Date().toISOString(),
      sentAt: new Date().toISOString()
    });
  }

  const maxHistory = 5000;

  if (history.sentNews.length > maxHistory) {
    history.sentNews =
      history.sentNews.slice(-maxHistory);
  }

  saveHistory(history);
}

/**
 * حذف تاریخچه قدیمی
 */
function cleanupHistory(days = 30) {
  const history = loadHistory();

  const cutoff =
    Date.now() -
    Number(days) * 24 * 60 * 60 * 1000;

  history.sentNews =
    history.sentNews.filter(item => {
      const sentTime =
        new Date(item.sentAt).getTime();

      return sentTime >= cutoff;
    });

  saveHistory(history);
}

/**
 * تعداد اخبار ثبت‌شده
 */
function getHistoryCount() {
  const history = loadHistory();

  return history.sentNews.length;
}

module.exports = {
  loadHistory,
  saveHistory,
  hasBeenSent,
  markAsSent,
  markManyAsSent,
  cleanupHistory,
  getHistoryCount
};
