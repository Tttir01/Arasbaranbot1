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
      'Mozilla/5.0 ArasbaranNewsBot/3.0'
  }
});

/*
 * فقط اخبار 48 ساعت اخیر
 */
const MAX_NEWS_AGE_HOURS = 48;

/*
 * مناطق مجاز
 */
const LOCAL_AREAS = [
  'ورزقان',
  'خاروانا',
  'اهر',
  'کلیبر',
  'كليبر',
  'هوراند',
  'خداآفرین',
  'خدا آفرین',
  'ارسباران'
];

/*
 * کلمات و نشانه‌های منابع خارجی
 */
const FOREIGN_KEYWORDS = [
  'afghanistan',
  'pakistan',
  'india',
  'iran international',
  'afghanistan international',
  'bbc',
  'bbc news',
  'cnn',
  'reuters',
  'al jazeera',
  'aljazeera',
  'dw',
  'euronews',
  'voa',
  'france24',
  'associated press',
  'ap news',
  'new york times',
  'washington post',
  'guardian',
  'facebook.com',
  'youtube.com',
  'instagram.com'
];

/*
 * کلمات محتوایی خارجی
 */
const FOREIGN_CONTENT_KEYWORDS = [
  'افغانستان',
  'پاکستان',
  'هند',
  'اسرائیل',
  'آمریکا',
  'انگلیس',
  'بریتانیا',
  'روسیه',
  'اوکراین',
  'غزه',
  'فلسطین',
  'لبنان',
  'سوریه',
  'عراق',
  'یمن'
];

/*
 * موضوعات کاملاً نامرتبط
 */
const IRRELEVANT_KEYWORDS = [
  'فال',
  'سرگرمی',
  'سلبریتی',
  'بازیگر',
  'خواننده',
  'فیلم',
  'سریال',
  'فوتبال اروپا',
  'لیگ قهرمانان اروپا',
  'جام جهانی',
  'بورس آمریکا',
  'bitcoin',
  'crypto',
  'cryptocurrency'
];

/*
 * ساخت شناسه یکتا
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

/*
 * پاک‌سازی HTML و RSS
 */
function stripHtml(text) {
  if (!text) {
    return '';
  }

  return String(text)
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      ' '
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      ' '
    )
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/*
 * پاک‌سازی نام رسانه و عنوان
 */
function cleanText(text) {
  return stripHtml(text)
    .replace(
      /\s*[-–—|]\s*(facebook\.com|youtube\.com|instagram\.com)\s*$/i,
      ''
    )
    .trim();
}

/*
 * استخراج نام منبع
 */
function extractSourceName(item, source) {
  if (item.creator) {
    return cleanText(item.creator);
  }

  if (item.author) {
    return cleanText(item.author);
  }

  if (item['dc:creator']) {
    return cleanText(
      item['dc:creator']
    );
  }

  /*
   * در Google News معمولاً نام ناشر
   * داخل title یا source وجود دارد.
   */
  if (
    item.source &&
    typeof item.source === 'object'
  ) {
    if (item.source.title) {
      return cleanText(
        item.source.title
      );
    }
  }

  if (source && source.name) {
    return cleanText(
      source.name
    );
  }

  return '';
}

/*
 * استخراج تاریخ انتشار
 */
function getPublishedDate(item) {
  const value =
    item.isoDate ||
    item.pubDate ||
    item.published ||
    item.updated;

  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

/*
 * بررسی اینکه خبر حداکثر 48 ساعت عمر دارد
 */
function isRecentNews(date) {
  if (!date) {
    return false;
  }

  const now = Date.now();

  const age =
    now - date.getTime();

  const maxAge =
    MAX_NEWS_AGE_HOURS *
    60 *
    60 *
    1000;

  /*
   * خبر آینده نیز پذیرفته نمی‌شود
   */
  if (age < 0) {
    return false;
  }

  return age <= maxAge;
}

/*
 * بررسی منطقه‌ای
