'use strict';

const Parser = require('rss-parser');
const crypto = require('crypto');

const { getConfig } = require('./config');
const { getGoogleNewsSources } = require('./sources');

const CONFIG = getConfig();

const parser = new Parser({
  timeout: CONFIG.news.requestTimeout,
  headers: {
    'User-Agent': 'Mozilla/5.0 ArasbaranNewsBot/3.0'
  }
});

const MAX_NEWS_AGE_HOURS = 48;

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
 * منابع و رسانه‌های خارجی که نباید منتشر شوند.
 */
const FOREIGN_SOURCE_KEYWORDS = [
  'bbc',
  'cnn',
  'reuters',
  'al jazeera',
  'aljazeera',
  'dw',
  'euronews',
  'voa',
  'france24',
  'france 24',
  'associated press',
  'ap news',
  'new york times',
  'washington post',
  'the guardian',
  'iran international',
  'afghanistan international',
  'afghanistan',
  'pakistan'
];

/*
 * موضوعات کاملاً نامرتبط با هدف ربات.
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
 * پاک کردن HTML و موجودیت‌های متداول.
 */
function cleanText(value) {
  if (!value) {
    return '';
  }

  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, function(match, code) {
      try {
        return String.fromCharCode(Number(code));
      } catch (error) {
        return ' ';
      }
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/*
 * تبدیل تاریخ RSS به Date معتبر.
 */
function parseDate(value) {
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
 * بررسی اینکه خبر حداکثر 48 ساعت گذشته باشد.
 */
function isRecentNews(item) {
  const publishedAt = parseDate(
    item.publishedAt ||
    item.pubDate ||
    item.isoDate ||
    item.date
  );

  if (!publishedAt) {
    return false;
  }

  const now = Date.now();

  const ageHours =
    (now - publishedAt.getTime()) /
    (1000 * 60 * 60);

  return ageHours >= 0 &&
    ageHours <= MAX_NEWS_AGE_HOURS;
}

/*
 * بررسی محلی بودن خبر.
 */
function isLocalNews(item) {
  const text = [
    item.title || '',
    item.description || '',
    item.content || '',
    item.sourceName || '',
    item.link || ''
  ]
    .join(' ')
    .toLowerCase();

  return LOCAL_AREAS.some(function(area) {
    return text.includes(
      String(area).toLowerCase()
    );
  });
}

/*
 * تشخیص منابع خارجی.
 *
 * نکته:
 * فقط وجود یک کلمه خارجی در متن کافی نیست.
 * ابتدا عنوان، نام منبع و لینک بررسی می‌شود.
 */
function isForeignNews(item) {
  const sourceText = [
    item.sourceName || '',
    item.creator || '',
    item.publisher || '',
    item.title || '',
    item.link || ''
  ]
    .join(' ')
    .toLowerCase();

  return FOREIGN_SOURCE_KEYWORDS.some(
    function(keyword) {
      return sourceText.includes(
        keyword.toLowerCase()
      );
    }
  );
}

/*
 * حذف موضوعات نامرتبط.
 */
function isIrrelevantNews(item) {
  const text = [
    item.title || '',
    item.description || '',
    item.content || ''
  ]
    .join(' ')
    .toLowerCase();

  return IRRELEVANT_KEYWORDS.some(
    function(keyword) {
      return text.includes(
        keyword.toLowerCase()
      );
    }
  );
}

/*
 * استخراج URL تصویر از RSS.
 */
function extractImageUrl(item) {
  if (!item) {
    return '';
  }

  /*
   * enclosure
   */
  if (
    item.enclosure &&
    item.enclosure.url &&
    (
      !item.enclosure.type ||
      String(item.enclosure.type)
        .toLowerCase()
        .startsWith('image/')
    )
  ) {
    return item.enclosure.url;
  }

  /*
   * media:content
   */
  if (
    item['media:content'] &&
    item['media:content']['$'] &&
    item['media:content']['$'].url
  ) {
    const type =
      item['media:content']['$'].type || '';

    if (
      !type ||
      String(type)
        .toLowerCase()
        .startsWith('image/')
    ) {
      return item['media:content']['$'].url;
    }
  }

  /*
   * media:thumbnail
   */
  if (
    item['media:thumbnail'] &&
    item['media:thumbnail']['$'] &&
    item['media:thumbnail']['$'].url
  ) {
    return item['media:thumbnail']['$'].url;
  }

  /*
   * استخراج اولین تصویر از متن HTML.
   */
  const html = [
    item.content || '',
    item.description || '',
    item.summary || ''
  ].join(' ');

  const match = html.match(
    /<img[^>]+src=["']([^"']+)["']/i
  );

  if (match && match[1]) {
    return match[1];
  }

  return '';
}

/*
 * استخراج URL ویدئو از RSS.
 */
function extractVideoUrl(item) {
  if (!item) {
    return '';
  }

  /*
   * enclosure
   */
  if (
    item.enclosure &&
    item.enclosure.url
  ) {
    const type =
      item.enclosure.type || '';

    if (
      String(type)
        .toLowerCase()
        .startsWith('video/')
    ) {
      return item.enclosure.url;
    }

    const url =
      String(item.enclosure.url)
        .toLowerCase();

    if (
      url.endsWith('.mp4') ||
      url.endsWith('.webm') ||
      url.endsWith('.mov') ||
      url.endsWith('.m4v')
    ) {
      return item.enclosure.url;
    }
  }

  /*
   * media:content
   */
  if (
    item['media:content'] &&
    item['media:content']['$'] &&
    item['media:content']['$'].url
  ) {
    const media =
      item['media:content']['$'];

    const type = media.type || '';

    if (
      String(type)
        .toLowerCase()
        .startsWith('video/')
    ) {
      return media.url;
    }
  }

  return '';
}

/*
 * تشخیص منبع از RSS.
 */
function getSourceName(item, source) {
  if (
    item &&
    item.source &&
    typeof item.source === 'object' &&
    item.source._
  ) {
    return cleanText(item.source._);
  }

  if (
    item &&
    item.source &&
    typeof item.source === 'string'
  ) {
    return cleanText(item.source);
  }

  if (item && item.creator) {
    return cleanText(item.creator);
  }

  if (source && source.name) {
    return cleanText(source.name);
  }

  return '';
}

/*
 * ایجاد شناسه پایدار برای خبر.
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
    .digest('hex');
}

/*
 * تبدیل RSS item به ساختار استاندارد.
 */
function normalizeItem(item, source) {
  const title = cleanText(
    item.title || ''
  );

  const description = cleanText(
    item.contentSnippet ||
    item.content ||
    item.summary ||
    item.description ||
    ''
  );

  const publishedAt =
    parseDate(
      item.isoDate ||
      item.pubDate ||
      item.published ||
      item.date
    );

  const sourceName =
    getSourceName(item, source);

  const imageUrl =
    extractImageUrl(item);

  const videoUrl =
    extractVideoUrl(item);

  const normalized = {
    id: createNewsId({
      title: title,
      link: item.link || '',
      publishedAt: publishedAt
        ? publishedAt.toISOString()
        : ''
    }),

    title: title,

    description: description,

    content: description,

    link: item.link || '',

    publishedAt: publishedAt
      ? publishedAt.toISOString()
      : null,

    sourceName: sourceName,

    creator: item.creator || '',

    publisher: sourceName,

    imageUrl: imageUrl,

    videoUrl: videoUrl,

    area: source && source.name
      ? source.name
      : ''
  };

  return normalized;
}

/*
 * دریافت اخبار یک منبع.
 */
async function fetchSource(source) {
  try {
    console.log(
      `در حال دریافت: ${source.name}`
    );

    const feed = await parser.parseURL(
      source.url
    );

    if (
      !feed ||
      !Array.isArray(feed.items)
    ) {
      return [];
    }

    const maxItems =
      Number(
        CONFIG.news.maxItemsPerSource || 10
      );

    return feed.items
      .slice(0, maxItems)
      .map(function(item) {
        return normalizeItem(
          item,
          source
        );
      });

  } catch (error) {
    console.error(
      `خطا در دریافت منبع ${source.name}:`,
      error.message
    );

    return [];
  }
}

/*
 * حذف اخبار تکراری.
 */
function removeDuplicates(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key =
      item.id ||
      item.link ||
      item.title;

    if (!key) {
      continue;
    }

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

/*
 * دریافت تمام اخبار واجد شرایط.
 */
async function fetchAllNews() {
  const sources =
    getGoogleNewsSources();

  if (!sources.length) {
    console.log(
      'هیچ منبع فعالی پیدا نشد.'
    );

    return [];
  }

  const allItems = [];

  for (const source of sources) {
    const items =
      await fetchSource(source);

    for (const item of items) {
      allItems.push(item);
    }
  }

  console.log(
    `کل اخبار خام: ${allItems.length}`
  );

  /*
   * 1. فقط اخبار 48 ساعت اخیر
   */
  let filtered =
    allItems.filter(isRecentNews);

  console.log(
    `بعد از فیلتر 48 ساعت: ${filtered.length}`
  );

  /*
   * 2. فقط اخبار محلی ارسباران
   */
  filtered =
    filtered.filter(isLocalNews);

  console.log(
    `بعد از فیلتر محلی: ${filtered.length}`
  );

  /*
   * 3. حذف منابع خارجی
   */
  filtered =
    filtered.filter(function(item) {
      return !isForeignNews(item);
    });

  console.log(
    `بعد از حذف منابع خارجی: ${filtered.length}`
  );

  /*
   * 4. حذف موضوعات نامرتبط
   */
  filtered =
    filtered.filter(function(item) {
      return !isIrrelevantNews(item);
    });

  console.log(
    `بعد از حذف اخبار نامرتبط: ${filtered.length}`
  );

  /*
   * 5. حذف تکراری‌ها
   */
  filtered =
    removeDuplicates(filtered);

  /*
   * مرتب‌سازی از جدیدترین به قدیمی‌ترین
   */
  filtered.sort(function(a, b) {
    const dateA =
      a.publishedAt
        ? new Date(a.publishedAt).getTime()
        : 0;

    const dateB =
      b.publishedAt
        ? new Date(b.publishedAt).getTime()
        : 0;

    return dateB - dateA;
  });

  /*
   * محدودیت تعداد کل اخبار
   */
  const maxTotal =
    Number(
      CONFIG.news.maxTotalItems || 30
    );

  return filtered.slice(
    0,
    maxTotal
  );
}

module.exports = {
  fetchAllNews,
  isRecentNews,
  isLocalNews,
  isForeignNews,
  isIrrelevantNews,
  extractImageUrl,
  extractVideoUrl,
  normalizeItem
};
