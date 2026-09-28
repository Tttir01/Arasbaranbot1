'use strict';

const Parser = require('rss-parser');
const cheerio = require('cheerio');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const { loadSources } = require('./sources');

const REQUEST_TIMEOUT = Number(
  process.env.REQUEST_TIMEOUT || 25000
);

const MAX_AGE_HOURS = Number(
  process.env.MAX_NEWS_AGE_HOURS || 48
);

const MAX_ITEMS_PER_SOURCE = Number(
  process.env.MAX_ITEMS_PER_SOURCE || 20
);

const parser = new Parser({
  timeout: REQUEST_TIMEOUT,
  headers: {
    'User-Agent':
      'Mozilla/5.0 ArasbaranNewsBot/4.0'
  }
});

const AREA_KEYWORDS = [
  'ورزقان',
  'خاروانا',
  'اهر',
  'کلیبر',
  'كليبر',
  'هوراند',
  'خداآفرین',
  'خداآفرين',
  'خدا آفرین',
  'خدا آفرين',
  'ارسباران',
  'قره داغ',
  'قره‌داغ',
  'سونگون'
];

const FOREIGN_KEYWORDS = [
  'آمریکا',
  'امریکا',
  'ترامپ',
  'اسرائیل',
  'اوکراین',
  'روسیه',
  'چین',
  'انگلیس',
  'بریتانیا',
  'فرانسه',
  'غزه',
  'لبنان',
  'ناتو'
];

/* =========================
   TEXT
========================= */

function normalizeText(value) {
  return String(value || '')
    .replace(/\u200c/g, ' ')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ۀة]/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(value) {
  if (!value) return '';

  const $ = cheerio.load(
    `<div>${String(value)}</div>`
  );

  return $.root()
    .text()
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/www\.\S+/gi, '')
    .replace(/t\.me\/\S+/gi, '')
    .replace(/instagram\.com\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(value, base) {
  if (!value) return '';

  try {
    return new URL(value, base).href;
  } catch {
    return '';
  }
}

/* =========================
   HTTP
========================= */

function request(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('URL خالی است.'));
      return;
    }

    if (redirects > 6) {
      reject(
        new Error('Redirect بیش از حد مجاز')
      );
      return;
    }

    let parsed;

    try {
      parsed = new URL(url);
    } catch {
      reject(
        new Error(`URL نامعتبر: ${url}`)
      );
      return;
    }

    const client =
      parsed.protocol === 'https:'
        ? https
        : http;

    const req = client.request(
      parsed,
      {
        method: 'GET',
        timeout: REQUEST_TIMEOUT,
        headers: {
          'User-Agent':
            'Mozilla/5.0 ArasbaranNewsBot/4.0',
          Accept:
            'text/html,application/xhtml+xml,application/xml,image/*,*/*'
        }
      },
      res => {
        const status = res.statusCode || 0;

        if (
          [301, 302, 303, 307, 308].includes(
            status
          ) &&
          res.headers.location
        ) {
          res.resume();

          const next = absoluteUrl(
            res.headers.location,
            url
          );

          request(next, redirects + 1)
            .then(resolve)
            .catch(reject);

          return;
        }

        const chunks = [];

        res.on('data', chunk => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          if (status < 200 || status >= 400) {
            reject(
              new Error(
                `HTTP ${status}: ${url}`
              )
            );
            return;
          }

          resolve({
            buffer: Buffer.concat(chunks),
            headers: res.headers,
            status
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(
        new Error(`Timeout: ${url}`)
      );
    });

    req.on('error', reject);

    req.end();
  });
}

async function getHtml(url) {
  const result = await request(url);

  return result.buffer.toString('utf8');
}

/* =========================
   DATE
========================= */

function persianDigitsToEnglish(value) {
  return String(value || '')
    .replace(/[۰-۹]/g, ch =>
      String(
        '۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)
      )
    )
    .replace(/[٠-٩]/g, ch =>
      String(
        '٠١٢٣٤٥٦٧٨٩'.indexOf(ch)
      )
    );
}

function jalaliToGregorian(
  jy,
  jm,
  jd
) {
  let gy;

  if (jy > 979) {
    gy = 1600;
    jy -= 979;
  } else {
    gy = 621;
  }

  let days =
    365 * jy +
    Math.floor(jy / 33) * 8 +
    Math.floor(
      ((jy % 33) + 3) / 4
    ) +
    78 +
    jd +
    (jm < 7
      ? (jm - 1) * 31
      : (jm - 7) * 30 + 186);

  gy +=
    400 *
    Math.floor(days / 146097);

  days %= 146097;

  let leap = true;

  if (days >= 36525) {
    days--;

    gy +=
      100 *
      Math.floor(days / 36524);

    days %= 36524;

    if (days >= 365) {
      days++;
    } else {
      leap = false;
    }
  }

  gy +=
    4 *
    Math.floor(days / 1461);

  days %= 1461;

  if (days >= 366) {
    leap = false;

    days--;

    gy +=
      Math.floor(days / 365);

    days %= 365;
  }

  const monthDays = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ];

  let gm = 1;

  for (let i = 0; i < 12; i++) {
    if (days < monthDays[i]) {
      gm = i + 1;
      break;
    }

    days -= monthDays[i];
  }

  return {
    gy,
    gm,
    gd: days + 1
  };
}

function parseDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return isNaN(value.getTime())
      ? null
      : value;
  }

  let text =
    persianDigitsToEnglish(value)
      .replace(/\u200c/g, ' ')
      .trim();

  if (!text) return null;

  /*
   * ISO / RFC / Telegram datetime
   */
  const direct = new Date(text);

  if (!isNaN(direct.getTime())) {
    return direct;
  }

  /*
   * YYYY/MM/DD HH:mm
   */
  const match = text.match(
    /(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:\s+|-)\s*(\d{1,2})?:?(\d{2})?/
  );

  if (!match) {
    return null;
  }

  const year =
    Number(match[1]);

  const month =
    Number(match[2]);

  const day =
    Number(match[3]);

  const hour =
    Number(match[4] || 0);

  const minute =
    Number(match[5] || 0);

  /*
   * سال شمسی
   */
  if (
    year >= 1300 &&
    year <= 1500
  ) {
    const g =
      jalaliToGregorian(
        year,
        month,
        day
      );

    const date =
      new Date(
        Date.UTC(
          g.gy,
          g.gm - 1,
          g.gd,
          hour,
          minute
        )
      );

    return isNaN(date.getTime())
      ? null
      : date;
  }

  const date =
    new Date(
      year,
      month - 1,
      day,
      hour,
      minute
    );

  return isNaN(date.getTime())
    ? null
    : date;
}

/* =========================
   IMAGE
========================= */

function extractImage(
  $,
  root,
  baseUrl
) {
  const selectors = [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="twitter:image"]'
  ];

  for (const selector of selectors) {
    const value =
      root
        .find(selector)
        .attr('content');

    if (value) {
      const image =
        absoluteUrl(
          value,
          baseUrl
        );

      if (image) return image;
    }
  }

  const img =
    root
      .find('img')
      .first()
      .attr('src');

  return absoluteUrl(
    img,
    baseUrl
  );
}

function extractTelegramImage(
  $
) {
  const photo =
    $('.tgme_widget_message_photo_wrap')
      .first();

  if (!photo.length) {
    return '';
  }

  const style =
    photo.attr('style') || '';

  const match =
    style.match(
      /background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i
    );

  if (match) {
    return match[1];
  }

  return (
    photo
      .find('img')
      .first()
      .attr('src') ||
    photo
      .find('a')
      .first()
      .attr('href') ||
    ''
  );
}

/* =========================
   NORMALIZE
========================= */

function makeId(
  title,
  link,
  source
) {
  return crypto
    .createHash('sha1')
    .update(
      normalizeText(
        `${title}|${link}|${source}`
      )
    )
    .digest('hex');
}

function normalizeItem(
  raw,
  source
) {
  const title =
    cleanText(raw.title);

  if (!title) {
    return null;
  }

  const description =
    cleanText(
      raw.description ||
      raw.content ||
      raw.text ||
      ''
    );

  const link =
    absoluteUrl(
      raw.link ||
      raw.url ||
      '',
      source.url
    );

  const image =
    absoluteUrl(
      raw.image ||
      raw.imageUrl ||
      '',
      source.url
    );

  const publishedAt =
    parseDate(
      raw.publishedAt ||
      raw.pubDate ||
      raw.date ||
      ''
    );

  return {
    id: makeId(
      title,
      link,
      source.name ||
        source.id ||
        ''
    ),

    title,

    description,

    link,

    image,

    imageUrl: image,

    sourceName:
      source.name ||
      source.id ||
      'منبع خبری',

    sourceId:
      source.id || '',

    publishedAt:
      publishedAt
        ? publishedAt.toISOString()
        : null
  };
}

/* =========================
   FILTER
========================= */

function containsArea(text) {
  const value =
    normalizeText(text);

  return AREA_KEYWORDS.some(
    keyword =>
      value.includes(
        normalizeText(keyword)
      )
  );
}

function containsForeign(text) {
  const value =
    normalizeText(text);

  return FOREIGN_KEYWORDS.some(
    keyword =>
      value.includes(
        normalizeText(keyword)
      )
  );
}

function isLocalNews(item) {
  if (!item) return false;

  /*
   * فقط متن واقعی خبر.
   * sourceName و URL عمداً استفاده نمی‌شوند.
   */
  const text =
    `${item.title} ${item.description}`;

  return containsArea(text);
}

function isForeignNews(item) {
  if (!item) return false;

  const text =
    `${item.title} ${item.description}`;

  if (containsArea(text)) {
    return false;
  }

  return containsForeign(text);
}

function isRecentNews(item) {
  /*
   * خبر بدون تاریخ را رد می‌کنیم.
   */
  if (
    !item ||
    !item.publishedAt
  ) {
    return false;
  }

  const published =
    new Date(
      item.publishedAt
    );

  if (
    isNaN(
      published.getTime()
    )
  ) {
    return false;
  }

  const age =
    Date.now() -
    published.getTime();

  /*
   * خبر خیلی آینده‌دار مشکوک است.
   */
  if (
    age <
    -6 * 60 * 60 * 1000
  ) {
    return false;
  }

  return (
    age <=
    MAX_AGE_HOURS *
      60 *
      60 *
      1000
  );
}

/* =========================
   RSS
========================= */

async function fetchRss(
  source
) {
  try {
    const feed =
      await parser.parseURL(
        source.url
      );

    return (
      feed.items || []
    )
      .slice(
        0,
        MAX_ITEMS_PER_SOURCE
      )
      .map(item =>
        normalizeItem(
          {
            title:
              item.title,

            description:
              item.contentSnippet ||
              item.content ||
              item.summary ||
              '',

            link:
              item.link,

            image:
              item.enclosure &&
              item.enclosure.url
                ? item.enclosure.url
                : '',

            publishedAt:
              item.isoDate ||
              item.pubDate ||
              item.published ||
              ''
          },
          source
        )
      )
      .filter(Boolean);
  } catch (error) {
    console.log(
      `❌ RSS ${source.name}: ${error.message}`
    );

    return [];
  }
}

/* =========================
   GOOGLE NEWS
========================= */

async function fetchGoogle(
  source
) {
  try {
    const feed =
      await parser.parseURL(
        source.url
      );

    return (
      feed.items || []
    )
      .slice(
        0,
        MAX_ITEMS_PER_SOURCE
      )
      .map(item =>
        normalizeItem(
          {
            title:
              item.title,

            description:
              item.contentSnippet ||
              item.content ||
              item.summary ||
              '',

            link:
              item.link,

            publishedAt:
              item.isoDate ||
              item.pubDate ||
              ''
          },
          source
        )
      )
      .filter(Boolean);
  } catch (error) {
    console.log(
      `❌ Google News ${source.name}: ${error.message}`
    );

    return [];
  }
}

/* =========================
   TELEGRAM
========================= */

function parseTelegramBlock(
  html,
  source
) {
  const $ =
    cheerio.load(html);

  const message =
    $('.tgme_widget_message')
      .first();

  if (!message.length) {
    return null;
  }

  const text =
    cleanText(
      message
        .find(
          '.tgme_widget_message_text'
        )
        .text()
    );

  if (!text) {
    return null;
  }

  const time =
    message
      .find(
        '.tgme_widget_message_date time[datetime]'
      )
      .first()
      .attr('datetime') ||
    '';

  const link =
    message
      .find(
        '.tgme_widget_message_date'
      )
      .first()
      .attr('href') ||
    '';

  const image =
    extractTelegramImage($);

  const lines =
    text
      .split(/\n+/)
      .map(x => x.trim())
      .filter(Boolean);

  const title =
    lines[0] ||
    'خبر جدید';

  const description =
    lines
      .slice(1)
      .join(' ')
      .trim();

  return normalizeItem(
    {
      title,
      description,
      link,
      image,
      publishedAt: time
    },
    source
  );
}

async function fetchTelegram(
  source
) {
  try {
    const html =
      await getHtml(
        source.url
      );

    const $ =
      cheerio.load(html);

    const blocks =
      $('.tgme_widget_message')
        .toArray();

    if (!blocks.length) {
      console.log(
        `⚠️ ${source.name}: پیام پیدا نشد`
      );

      return [];
    }

    return blocks
      .slice(
        -MAX_ITEMS_PER_SOURCE
      )
      .map(block =>
        parseTelegramBlock(
          $.html(block),
          source
        )
      )
      .filter(Boolean);
  } catch (error) {
    console.log(
      `❌ Telegram ${source.name}: ${error.message}`
    );

    return [];
  }
}

/* =========================
   HTML / TASNIM
========================= */

function findArticleLinks(
  $,
  baseUrl
) {
  const links = [];
  const seen = new Set();

  $('a[href]').each(
    (_, element) => {
      const href =
        $(element).attr(
          'href'
        );

      if (!href) return;

      const url =
        absoluteUrl(
          href,
          baseUrl
        );

      if (!url) return;

      if (
        !/\/fa\/news\//i.test(
          url
        )
      ) {
        return;
      }

      if (seen.has(url)) {
        return;
      }

      seen.add(url);
      links.push(url);
    }
  );

  return links.slice(
    0,
    MAX_ITEMS_PER_SOURCE
  );
}

function articleDate($) {
  const selectors = [
    'time[datetime]',
    'meta[property="article:published_time"]',
    'meta[name="publish-date"]',
    '[itemprop="datePublished"]'
  ];

  for (
    const selector
    of selectors
  ) {
    const element =
      $(selector).first();

    if (!element.length) {
      continue;
    }

    const value =
      element.attr('datetime') ||
      element.attr('content') ||
      element.text();

    const date =
      parseDate(value);

    if (date) {
      return date;
    }
  }

  const body =
    $('body').text();

  const match =
    body.match(
      /(\d{4}\/\d{1,2}\/\d{1,2})\s*[-–]\s*(\d{1,2}:\d{2})/
    );

  if (match) {
    return parseDate(
      `${match[1]} ${match[2]}`
    );
  }

  return null;
}

function articleBody($) {
  const selectors = [
    'article',
    '[itemprop="articleBody"]',
    '.story-content',
    '.news-content',
    '.article-content',
    '.story'
  ];

  for (
    const selector
    of selectors
  ) {
    const element =
      $(selector).first();

    if (!element.length) {
      continue;
    }

    const text =
      cleanText(
        element.text()
      );

    if (text.length >= 80) {
      return text.substring(
        0,
        4000
      );
    }
  }

  return $('p')
    .map(
      (_, element) =>
        cleanText(
          $(element).text()
        )
    )
    .get()
    .filter(
      text => text.length >= 30
    )
    .join(' ')
    .substring(
      0,
      4000
    );
}

async function fetchArticle(
  url,
  source
) {
  try {
    const html =
      await getHtml(url);

    const $ =
      cheerio.load(html);

    const title =
      $('meta[property="og:title"]')
        .attr('content') ||
      $('h1')
        .first()
        .text() ||
      $('title')
        .text();

    const description =
      $('meta[property="og:description"]')
        .attr('content') ||
      $('meta[name="description"]')
        .attr('content') ||
      articleBody($);

    const image =
      $('meta[property="og:image"]')
        .attr('content') ||
      $('meta[name="twitter:image"]')
        .attr('content') ||
      '';

    const publishedAt =
      articleDate($);

    return normalizeItem(
      {
        title,
        description,
        link: url,
        image,
        publishedAt
      },
      source
    );
  } catch (error) {
    console.log(
      `⚠️ مقاله ${url}: ${error.message}`
    );

    return null;
  }
}

async function fetchHtml(
  source
) {
  try {
    const html =
      await getHtml(
        source.url
      );

    const $ =
      cheerio.load(html);

    const links =
      findArticleLinks(
        $,
        source.url
      );

    const results = [];

    /*
     * حداکثر 4 مقاله همزمان
     */
    for (
      let i = 0;
      i < links.length;
      i += 4
    ) {
      const batch =
        links.slice(
          i,
          i + 4
        );

      const fetched =
        await Promise.all(
          batch.map(url =>
            fetchArticle(
              url,
              source
            )
          )
        );

      fetched.forEach(
        item => {
          if (item) {
            results.push(item);
          }
        }
      );
    }

    return results;
  } catch (error) {
    console.log(
      `❌ HTML ${source.name}: ${error.message}`
    );

    return [];
  }
}

/* =========================
   SOURCE
========================= */

async function fetchSource(
  source
) {
  console.log(
    `\n🔎 دریافت: ${source.name}`
  );

  let items = [];

  const type =
    String(
      source.type || 'rss'
    ).toLowerCase();

  if (
    type === 'telegram'
  ) {
    items =
      await fetchTelegram(
        source
      );
  } else if (
    type === 'html'
  ) {
    items =
      await fetchHtml(
        source
      );
  } else if (
    type === 'google-news' ||
    (
      type === 'rss' &&
      String(
        source.id || ''
      ).startsWith(
        'google-'
      )
    )
  ) {
    items =
      await fetchGoogle(
        source
      );
  } else if (
    type === 'rss'
  ) {
    items =
      await fetchRss(
        source
      );
  } else {
    console.log(
      `⚠️ نوع منبع ناشناخته: ${type}`
    );
  }

  console.log(
    `   📥 ${items.length} خبر خام`
  );

  return items;
}

/* =========================
   DUPLICATE
========================= */

function titleWords(title) {
  return new Set(
    normalizeText(title)
      .replace(
        /[^\p{L}\p{N}\s]/gu,
        ''
      )
      .split(/\s+/)
      .filter(
        word => word.length > 1
      )
  );
}

function similarity(
  a,
  b
) {
  const x =
    titleWords(a);

  const y =
    titleWords(b);

  if (!x.size || !y.size) {
    return 0;
  }

  let common = 0;

  x.forEach(word => {
    if (y.has(word)) {
      common++;
    }
  });

  const total =
    new Set([
      ...x,
      ...y
    ]).size;

  return total
    ? common / total
    : 0;
}

function uniqueItems(
  items
) {
  const result = [];
  const links = new Set();

  for (
    const item of items
  ) {
    if (!item) continue;

    if (
      item.link &&
      links.has(item.link)
    ) {
      continue;
    }

    const duplicate =
      result.some(
        old =>
          similarity(
            item.title,
            old.title
          ) >= 0.82
      );

    if (duplicate) {
      continue;
    }

    if (item.link) {
      links.add(
        item.link
      );
    }

    result.push(item);
  }

  return result;
}

/* =========================
   ALL NEWS
========================= */

async function fetchAllNews() {
  const sources =
    await loadSources();

  const all = [];

  console.log(
    `\n📡 منابع فعال: ${sources.length}`
  );

  for (
    const source
    of sources
  ) {
    try {
      const items =
        await fetchSource(
          source
        );

      all.push(
        ...items
      );
    } catch (error) {
      console.log(
        `❌ ${source.name}: ${error.message}`
      );
    }
  }

  console.log(
    `\n📦 خام: ${all.length}`
  );

  const unique =
    uniqueItems(all);

  console.log(
    `♻️ بدون تکرار: ${unique.length}`
  );

  const recent =
    unique.filter(
      isRecentNews
    );

  console.log(
    `⏱️ کمتر از ${MAX_AGE_HOURS} ساعت: ${recent.length}`
  );

  const local =
    recent.filter(
      isLocalNews
    );

  console.log(
    `📍 محلی: ${local.length}`
  );

  const final =
    local.filter(
      item =>
        !isForeignNews(item)
    );

  console.log(
    `🌍 نهایی: ${final.length}`
  );

  final.sort(
    (a, b) =>
      new Date(
        b.publishedAt
      ).getTime() -
      new Date(
        a.publishedAt
      ).getTime()
  );

  const max =
    Number(
      process.env.MAX_TOTAL_ITEMS ||
      30
    );

  return final.slice(
    0,
    max
  );
}

module.exports = {
  fetchAllNews,
  fetchSource,
  normalizeItem,
  isRecentNews,
  isLocalNews,
  isForeignNews,
  parseDate,
  cleanText
};
