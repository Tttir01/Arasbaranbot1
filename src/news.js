'use strict';

const Parser = require('rss-parser');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const { loadSources } = require('./sources');

const parser = new Parser({
  timeout: 30000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/128.0 Safari/537.36',
    'Accept':
      'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    'Accept-Language': 'fa-IR,fa;q=0.9,en-US;q=0.7,en;q=0.5'
  }
});

const MAX_NEWS_AGE_HOURS =
  Number(process.env.NEWS_MAX_AGE_HOURS || 48);

const MAX_ITEMS_PER_SOURCE =
  Number(process.env.MAX_ITEMS_PER_SOURCE || 20);

const LOCAL_KEYWORDS = [
  'ورزقان',
  'ورزقان',
  'خاروانا',
  'اهر',
  'کلیبر',
  'كليبر',
  'هوراند',
  'خداآفرین',
  'خدا آفرین',
  'خداآفرين',
  'ارسباران',
  'سونگون',
  'مس سونگون',
  'قره داغ',
  'قره‌داغ',
  'قره داغی',
  'آذربایجان شرقی',
  'آذربايجان شرقي',
  'تبریز',
  'اهر و ورزقان',
  'اهر و هوراند'
];

const FOREIGN_KEYWORDS = [
  'united states',
  'usa',
  'america',
  'uk',
  'united kingdom',
  'london',
  'canada',
  'australia',
  'france',
  'germany',
  'italy',
  'spain',
  'israel',
  'ukraine',
  'russia',
  'china',
  'japan',
  'india'
];

/* ---------------------------------------------------------
 * ابزار HTTP
 * --------------------------------------------------------- */

function httpGet(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('URL خالی است'));
      return;
    }

    if (redirects > 5) {
      reject(new Error('تعداد Redirect بیش از حد مجاز است'));
      return;
    }

    let client;

    try {
      client = url.startsWith('https://') ? https : http;
    } catch (error) {
      reject(error);
      return;
    }

    const request = client.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/128.0 Safari/537.36',
          'Accept':
            'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
          'Accept-Language':
            'fa-IR,fa;q=0.9,en-US;q=0.7,en;q=0.5',
          'Cache-Control': 'no-cache'
        },
        timeout: 30000
      },
      response => {
        const status = response.statusCode || 0;

        /*
         * Redirect
         */
        if (
          status >= 300 &&
          status < 400 &&
          response.headers.location
        ) {
          const location = new URL(
            response.headers.location,
            url
          ).toString();

          response.resume();

          console.log(
            `   ↪ Redirect ${status}: ${location}`
          );

          httpGet(location, redirects + 1)
            .then(resolve)
            .catch(reject);

          return;
        }

        let data = '';

        response.setEncoding('utf8');

        response.on('data', chunk => {
          data += chunk;
        });

        response.on('end', () => {
          console.log(
            `   HTTP ${status} | ${Buffer.byteLength(data, 'utf8')} bytes | ${url}`
          );

          if (status < 200 || status >= 300) {
            reject(
              new Error(
                `HTTP ${status} برای ${url}`
              )
            );
            return;
          }

          resolve(data);
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(
        new Error(`Timeout: ${url}`)
      );
    });

    request.on('error', reject);
  });
}

/* ---------------------------------------------------------
 * تاریخ
 * --------------------------------------------------------- */

function parseDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (!Number.isNaN(date.getTime())) {
    return date;
  }

  return null;
}

/* ---------------------------------------------------------
 * تصویر
 * --------------------------------------------------------- */

function extractImage(item) {
  try {
    if (item.enclosure && item.enclosure.url) {
      return item.enclosure.url;
    }

    if (
      item.media &&
      item.media.thumbnail &&
      item.media.thumbnail.$ &&
      item.media.thumbnail.$.url
    ) {
      return item.media.thumbnail.$.url;
    }

    if (
      item.media &&
      item.media.content &&
      item.media.content.url
    ) {
      return item.media.content.url;
    }

    const html =
      item.content ||
      item['content:encoded'] ||
      item.description ||
      '';

    const match = html.match(
      /<img[^>]+src=["']([^"']+)["']/i
    );

    if (match && match[1]) {
      return match[1];
    }
  } catch (error) {
    console.log(
      `⚠️ خطا در استخراج تصویر: ${error.message}`
    );
  }

  return null;
}

/* ---------------------------------------------------------
 * نرمال‌سازی خبر
 * --------------------------------------------------------- */

function normalizeItem(item, source) {
  const title =
    String(item.title || '')
      .replace(/\s+/g, ' ')
      .trim();

  const description =
    String(
      item.contentSnippet ||
      item.content ||
      item['content:encoded'] ||
      item.description ||
      ''
    )
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const link =
    item.link ||
    item.guid ||
    '';

  const publishedAt =
    parseDate(
      item.isoDate ||
      item.pubDate ||
      item.published ||
      item.updated ||
      item.date
    );

  const image =
    extractImage(item);

  const sourceName =
    source.name ||
    source.title ||
    'منبع نامشخص';

  return {
    id: crypto
      .createHash('sha1')
      .update(
        `${title}|${link}|${sourceName}`
      )
      .digest('hex'),

    title,
    description,
    link,
    image,

    sourceName,

    publishedAt:
      publishedAt
        ? publishedAt.toISOString()
        : null,

    rawPublishedAt:
      item.isoDate ||
      item.pubDate ||
      item.published ||
      item.updated ||
      item.date ||
      null
  };
}

/* ---------------------------------------------------------
 * تشخیص محلی بودن
 * --------------------------------------------------------- */

function containsLocalKeyword(text) {
  const value =
    String(text || '').toLowerCase();

  return LOCAL_KEYWORDS.some(keyword =>
    value.includes(
      String(keyword).toLowerCase()
    )
  );
}

function isLocalNews(item) {
  const text = [
    item.title,
    item.description,
    item.sourceName,
    item.link
  ]
    .filter(Boolean)
    .join(' ');

  return containsLocalKeyword(text);
}

/* ---------------------------------------------------------
 * حذف اخبار خارجی
 * --------------------------------------------------------- */

function containsForeignKeyword(text) {
  const value =
    String(text || '').toLowerCase();

  return FOREIGN_KEYWORDS.some(keyword =>
    value.includes(keyword.toLowerCase())
  );
}

function isForeignNews(item) {
  const title =
    String(item.title || '').toLowerCase();

  const description =
    String(item.description || '').toLowerCase();

  /*
   * فقط وقتی عنوان کاملاً به یک موضوع خارجی اشاره
   * می‌کند آن را حذف می‌کنیم.
   *
   * چون Google News ممکن است خبر محلی را از یک
   * رسانه خارجی هم نمایش دهد.
   */

  if (
    containsLocalKeyword(title) ||
    containsLocalKeyword(description)
  ) {
    return false;
  }

  return containsForeignKeyword(title);
}

/* ---------------------------------------------------------
 * تاریخ جدید بودن خبر
 * --------------------------------------------------------- */

function isRecentNews(item) {
  if (!item.publishedAt) {
    console.log(
      `⚠️ خبر بدون تاریخ پذیرفته شد: ${item.title}`
    );

    return true;
  }

  const published =
    new Date(item.publishedAt);

  const now =
    Date.now();

  const ageHours =
    (now - published.getTime()) /
    (1000 * 60 * 60);

  if (ageHours < -24) {
    /*
     * بعضی RSSها تاریخ آینده یا timezone
     * غیرعادی دارند.
     */
    console.log(
      `⚠️ تاریخ آینده: ${item.title}`
    );

    return true;
  }

  if (ageHours <= MAX_NEWS_AGE_HOURS) {
    return true;
  }

  return false;
}

/* ---------------------------------------------------------
 * ساخت Queryهای جایگزین Google News
 * --------------------------------------------------------- */

function buildGoogleQueries(source) {
  const base =
    String(
      source.query ||
      source.search ||
      source.name ||
      ''
    ).trim();

  const name =
    String(
      source.name ||
      base
    ).trim();

  const queries = [];

  function add(value) {
    if (!value) return;

    const clean =
      String(value).trim();

    if (!clean) return;

    if (!queries.includes(clean)) {
      queries.push(clean);
    }
  }

  /*
   * Query اصلی
   */
  add(base);
  add(name);

  /*
   * Queryهای مخصوص شهرها
   */

  if (
    /ورزقان/.test(name) ||
    /ورزقان/.test(base)
  ) {
    add('ورزقان آذربایجان شرقی');
    add('ورزقان سونگون');
    add('ورزقان شهرستان');
    add('"ورزقان" آذربایجان شرقی');
  }

  if (
    /خاروانا/.test(name) ||
    /خاروانا/.test(base)
  ) {
    add('خاروانا آذربایجان شرقی');
    add('خاروانا ورزقان');
    add('"خاروانا" آذربایجان شرقی');
  }

  if (
    /اهر/.test(name) ||
    /اهر/.test(base)
  ) {
    add('اهر آذربایجان شرقی');
    add('شهرستان اهر');
    add('اهر قره داغ');
    add('"اهر" آذربایجان شرقی');
  }

  if (
    /کلیبر/.test(name) ||
    /كليبر/.test(name) ||
    /کلیبر/.test(base) ||
    /كليبر/.test(base)
  ) {
    add('کلیبر آذربایجان شرقی');
    add('شهرستان کلیبر');
    add('کلیبر ارسباران');
    add('"کلیبر" آذربایجان شرقی');
  }

  if (
    /هوراند/.test(name) ||
    /هوراند/.test(base)
  ) {
    add('هوراند آذربایجان شرقی');
    add('شهرستان هوراند');
    add('"هوراند" آذربایجان شرقی');
  }

  if (
    /خداآفرین/.test(name) ||
    /خدا آفرین/.test(name) ||
    /خداآفرین/.test(base) ||
    /خدا آفرین/.test(base)
  ) {
    add('خداآفرین آذربایجان شرقی');
    add('خدا آفرین آذربایجان شرقی');
    add('شهرستان خداآفرین');
    add('"خداآفرین" آذربایجان شرقی');
  }

  if (
    /ارسباران/.test(name) ||
    /ارسباران/.test(base)
  ) {
    add('ارسباران آذربایجان شرقی');
    add('ارسباران قره داغ');
    add('منطقه ارسباران');
    add('"ارسباران" ایران');
  }

  /*
   * حداکثر 6 Query برای جلوگیری از درخواست زیاد
   */
  return queries.slice(0, 6);
}

/* ---------------------------------------------------------
 * ساخت URL Google News
 * --------------------------------------------------------- */

function buildGoogleNewsUrl(query, options = {}) {
  const q =
    encodeURIComponent(query);

  /*
   * اول fa/IR
   */
  const hl =
    options.hl || 'fa';

  const gl =
    options.gl || 'IR';

  const ceid =
    options.ceid || 'IR:fa';

  return (
    `https://news.google.com/rss/search` +
    `?q=${q}` +
    `&hl=${encodeURIComponent(hl)}` +
    `&gl=${encodeURIComponent(gl)}` +
    `&ceid=${encodeURIComponent(ceid)}`
  );
}

/* ---------------------------------------------------------
 * دریافت RSS
 * --------------------------------------------------------- */

async function fetchRssUrl(url, source) {
  console.log(
    `   URL: ${url}`
  );

  try {
    const xml =
      await httpGet(url);

    console.log(
      `   RSS bytes: ${xml.length}`
    );

    console.log(
      `   RSS شروع متن: ${xml
        .trim()
        .substring(0, 180)}`
    );

    /*
     * اگر Google به انگلیسی Redirect کرده باشد
     * همچنان XML را parse می‌کنیم.
     */

    const feed =
      await parser.parseString(xml);

    const items =
      Array.isArray(feed.items)
        ? feed.items
        : [];

    console.log(
      `   RSS items: ${items.length}`
    );

    if (items.length > 0) {
      console.log(
        `   نمونه خبر: ${items[0].title || 'بدون عنوان'}`
      );
    }

    return items
      .slice(0, MAX_ITEMS_PER_SOURCE)
      .map(item =>
        normalizeItem(item, source)
      )
      .filter(item => item.title);

  } catch (error) {
    console.log(
      `⚠️ خطای RSS: ${source.name}: ${error.message}`
    );

    return [];
  }
}

/* ---------------------------------------------------------
 * دریافت Google News با چند Query
 * --------------------------------------------------------- */

async function fetchGoogleNewsSource(source) {
  const queries =
    buildGoogleQueries(source);

  if (!queries.length) {
    console.log(
      `⚠️ Query برای ${source.name} پیدا نشد`
    );

    return [];
  }

  console.log(
    `🔎 تعداد Queryهای ${source.name}: ${queries.length}`
  );

  let allItems = [];

  for (
    let i = 0;
    i < queries.length;
    i++
  ) {
    const query =
      queries[i];

    console.log(
      `   🔍 Query ${i + 1}/${queries.length}: ${query}`
    );

    /*
     * اول درخواست فارسی ایران
     */
    const primaryUrl =
      buildGoogleNewsUrl(
        query,
        {
          hl: 'fa',
          gl: 'IR',
          ceid: 'IR:fa'
        }
      );

    let items =
      await fetchRssUrl(
        primaryUrl,
        source
      );

    /*
     * اگر صفر بود، یک بار با en-US/US
     * نیز امتحان می‌کنیم.
     *
     * این برای بعضی سرورهای GitHub Actions
     * که Redirect منطقه‌ای دریافت می‌کنند مفید است.
     */
    if (items.length === 0) {
      const fallbackUrl =
        buildGoogleNewsUrl(
          query,
          {
            hl: 'en-US',
            gl: 'US',
            ceid: 'US:en'
          }
        );

      console.log(
        `   🔁 تلاش جایگزین Google: ${query}`
      );

      items =
        await fetchRssUrl(
          fallbackUrl,
          source
        );
    }

    if (items.length > 0) {
      console.log(
        `   ✅ Query موفق: ${query} = ${items.length} خبر`
      );

      allItems =
        allItems.concat(items);

      /*
       * بعد از یافتن خبر، Queryهای بعدی
       * نیز اجرا می‌شوند ولی سقف نهایی کنترل می‌شود.
       */
    } else {
      console.log(
        `   ⭕ بدون خبر: ${query}`
      );
    }

    /*
     * جلوگیری از تعداد زیاد خبر
     */
    if (
      allItems.length >=
      MAX_ITEMS_PER_SOURCE
    ) {
      break;
    }
  }

  /*
   * حذف تکراری‌ها
   */
  const unique =
    new Map();

  for (const item of allItems) {
    const key =
      item.link ||
      `${item.title}|${item.sourceName}`;

    if (!unique.has(key)) {
      unique.set(key, item);
    }
  }

  const result =
    Array.from(unique.values())
      .slice(0, MAX_ITEMS_PER_SOURCE);

  console.log(
    `   🎯 مجموع خبرهای ${source.name}: ${result.length}`
  );

  return result;
}

/* ---------------------------------------------------------
 * دریافت RSS معمولی
 * --------------------------------------------------------- */

async function fetchNormalRssSource(source) {
  console.log(
    `📡 RSS شروع: ${source.name}`
  );

  console.log(
    `   URL: ${source.url}`
  );

  const items =
    await fetchRssUrl(
      source.url,
      source
    );

  if (items.length === 0) {
    console.log(
      `⚠️ RSS بدون خبر: ${source.name}`
    );
  }

  return items;
}

/* ---------------------------------------------------------
 * دریافت هر منبع
 * --------------------------------------------------------- */

async function fetchSource(source) {
  const type =
    String(
      source.type ||
      'rss'
    )
      .trim()
      .toLowerCase();

  /*
   * Google News
   */
  if (
    type === 'google-news' ||
    type === 'google_news' ||
    type === 'googlenews'
  ) {
    return fetchGoogleNewsSource(
      source
    );
  }

  /*
   * RSS
   */
  if (
    type === 'rss' ||
    type === 'xml'
  ) {
    return fetchNormalRssSource(
      source
    );
  }

  /*
   * HTML فعلاً RSS نیست.
   * فعلاً آن را حذف نمی‌کنیم؛ فقط گزارش می‌دهیم.
   */
  if (
    type === 'html'
  ) {
    console.log(
      `⚠️ منبع HTML فعلاً توسط RSS Reader پشتیبانی نمی‌شود: ${source.name}`
    );

    return [];
  }

  console.log(
    `⚠️ نوع منبع ناشناخته: ${type}`
  );

  return [];
}

/* ---------------------------------------------------------
 * حذف تکراری‌ها
 * --------------------------------------------------------- */

function deduplicateNews(items) {
  const map =
    new Map();

  for (const item of items) {
    const key =
      item.link ||
      `${item.title}|${item.sourceName}`;

    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return Array.from(
    map.values()
  );
}

/* ---------------------------------------------------------
 * دریافت همه اخبار
 * --------------------------------------------------------- */

async function fetchAllNews() {
  console.log(
    '================================'
  );

  console.log(
    'در حال دریافت اخبار...'
  );

  console.log(
    '================================'
  );

  const sources =
    await loadSources();

  const activeSources =
    Array.isArray(sources)
      ? sources.filter(
          source =>
            source &&
            source.enabled !== false
        )
      : [];

  console.log(
    `تعداد منابع فعال: ${activeSources.length}`
  );

  console.log(
    `حداکثر سن خبر: ${MAX_NEWS_AGE_HOURS} ساعت`
  );

  console.log(
    '================================'
  );

  let rawItems = [];

  let successSources = 0;
  let emptySources = 0;

  for (const source of activeSources) {
    console.log(
      `در حال دریافت: ${source.name}`
    );

    try {
      const items =
        await fetchSource(source);

      console.log(
        `   نتیجه ${source.name}: ${items.length}`
      );

      if (items.length > 0) {
        successSources++;
        rawItems =
          rawItems.concat(items);
      } else {
        emptySources++;
      }
    } catch (error) {
      emptySources++;

      console.log(
        `❌ خطا در ${source.name}: ${error.message}`
      );
    }
  }

  console.log(
    '================================'
  );

  console.log(
    `منابع موفق: ${successSources}`
  );

  console.log(
    `منابع خالی/ناموفق: ${emptySources}`
  );

  console.log(
    `کل اخبار خام: ${rawItems.length}`
  );

  /*
   * حذف تکراری‌ها
   */
  const beforeDedup =
    rawItems.length;

  rawItems =
    deduplicateNews(rawItems);

  console.log(
    `بعد از حذف تکراری: ${rawItems.length}`
  );

  console.log(
    `تعداد تکراری حذف‌شده: ${
      beforeDedup - rawItems.length
    }`
  );

  /*
   * فیلتر زمانی
   */
  const recentItems =
    rawItems.filter(
      isRecentNews
    );

  console.log(
    `بعد از فیلتر ${MAX_NEWS_AGE_HOURS} ساعت: ${recentItems.length}`
  );

  /*
   * فیلتر محلی
   */
  const localItems =
    recentItems.filter(
      isLocalNews
    );

  console.log(
    `بعد از فیلتر محلی: ${localItems.length}`
  );

  /*
   * حذف اخبار خارجی
   */
  const nonForeignItems =
    localItems.filter(
      item =>
        !isForeignNews(item)
    );

  console.log(
    `بعد از حذف اخبار خارجی: ${nonForeignItems.length}`
  );

  /*
   * مرتب‌سازی جدیدترین خبرها
   */
  nonForeignItems.sort(
    (a, b) => {
      const ta =
        a.publishedAt
          ? new Date(a.publishedAt).getTime()
          : 0;

      const tb =
        b.publishedAt
          ? new Date(b.publishedAt).getTime()
          : 0;

      return tb - ta;
    }
  );

  console.log(
    `تعداد اخبار دریافت‌شده: ${nonForeignItems.length}`
  );

  /*
   * نمایش جزئیات
   */
  if (
    nonForeignItems.length > 0
  ) {
    console.log(
      '================================'
    );

    console.log(
      'اخبار نهایی:'
    );

    nonForeignItems
      .slice(0, 30)
      .forEach(
        (item, index) => {
          console.log(
            `${index + 1}. ${item.title}`
          );

          console.log(
            `   منبع: ${item.sourceName}`
          );

          console.log(
            `   تاریخ: ${
              item.publishedAt || 'بدون تاریخ'
            }`
          );

          console.log(
            `   لینک: ${item.link || 'بدون لینک'}`
          );
        }
      );
  } else {
    console.log(
      'هیچ خبر جدید و واجد شرایطی دریافت نشد.'
    );
  }

  console.log(
    '================================'
  );

  return nonForeignItems;
}

/* ---------------------------------------------------------
 * صادرات
 * --------------------------------------------------------- */

module.exports = {
  fetchAllNews,
  fetchSource,
  fetchGoogleNewsSource,
  fetchNormalRssSource,
  isRecentNews,
  isLocalNews,
  isForeignNews,
  deduplicateNews,
  buildGoogleQueries,
  buildGoogleNewsUrl,
  normalizeItem,
  extractImage
};
