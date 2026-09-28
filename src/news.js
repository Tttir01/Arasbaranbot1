1) "src/news.js"

'use strict';

const Parser = require('rss-parser');
const cheerio = require('cheerio');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const { loadSources } = require('./sources');

const parser = new Parser({
  timeout: Number(process.env.REQUEST_TIMEOUT || 25000),
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36'
  }
});

const MAX_AGE_HOURS = Number(process.env.MAX_NEWS_AGE_HOURS || 48);
const MAX_ITEMS_PER_SOURCE = Number(process.env.MAX_ITEMS_PER_SOURCE || 20);
const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT || 25000);

const AREA_KEYWORDS = [
  'ورزقان',
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
  'اسرائیل',
  'اوکراین',
  'روسیه',
  'چین',
  'انگلیس',
  'بریتانیا',
  'فرانسه',
  'جنگ غزه',
  'غزه',
  'لبنان',
  'ناتو'
];

function normalizeText(value) {
  return String(value || '')
    .replace(/\u200c/g, ' ')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ۀة]/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(value) {
  if (!value) return '';

  return cheerio
    .load(`<div>${String(value)}</div>`)('div')
    .text()
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(value) {
  return cheerio
    .load(`<div>${String(value || '')}</div>`)('div')
    .text()
    .trim();
}

function cleanNewsText(value) {
  let text = stripHtml(value || '');

  text = text
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/www\.\S+/gi, '')
    .replace(/instagram\.com\/\S+/gi, '')
    .replace(/t\.me\/\S+/gi, '')
    .replace(/@\w+/g, '')
    .replace(/🆔/g, '')
    .replace(/👁‍🗨/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

function normalizeUrl(url, baseUrl) {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return '';
  }
}

function requestBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('URL خالی است.'));
      return;
    }

    if (redirects > 6) {
      reject(new Error('تعداد Redirect بیش از حد مجاز است.'));
      return;
    }

    let parsed;

    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(`URL نامعتبر: ${url}`));
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;

    const req = client.request(
      parsed,
      {
        method: 'GET',
        timeout: REQUEST_TIMEOUT,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml,image/avif,image/webp,*/*'
        }
      },
      res => {
        const status = res.statusCode || 0;

        if (
          [301, 302, 303, 307, 308].includes(status) &&
          res.headers.location
        ) {
          res.resume();

          const next = normalizeUrl(res.headers.location, url);

          requestBuffer(next, redirects + 1)
            .then(resolve)
            .catch(reject);

          return;
        }

        const chunks = [];

        res.on('data', chunk => chunks.push(chunk));

        res.on('end', () => {
          const buffer = Buffer.concat(chunks);

          if (status < 200 || status >= 400) {
            reject(
              new Error(`HTTP ${status} برای ${url}`)
            );
            return;
          }

          resolve({
            buffer,
            status,
            headers: res.headers
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout: ${url}`));
    });

    req.on('error', reject);

    req.end();
  });
}

async function httpGet(url) {
  const result = await requestBuffer(url);

  return {
    body: result.buffer.toString('utf8'),
    status: result.status,
    headers: result.headers
  };
}

/* -------------------------------------------------------
   تاریخ
------------------------------------------------------- */

function parseDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  const raw = String(value).trim();

  if (!raw) return null;

  const direct = new Date(raw);

  if (!isNaN(direct.getTime())) {
    return direct;
  }

  const normalized = raw
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\u200c/g, ' ')
    .trim();

  const match = normalized.match(
    /(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[ T،,-]+(\d{1,2})(?::(\d{1,2}))?)?/
  );

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);

  /*
   * اگر سال شمسی باشد، به میلادی تبدیل می‌کنیم.
   * سال‌های بالاتر از 1300 و پایین‌تر از 1500 را شمسی فرض می‌کنیم.
   */
  if (year >= 1300 && year <= 1500) {
    const g = jalaliToGregorian(year, month, day);

    const result = new Date(
      Date.UTC(g.gy, g.gm - 1, g.gd, hour, minute)
    );

    return isNaN(result.getTime()) ? null : result;
  }

  const result = new Date(
    year,
    month - 1,
    day,
    hour,
    minute
  );

  return isNaN(result.getTime()) ? null : result;
}

function jalaliToGregorian(jy, jm, jd) {
  let gy;
  let days;

  if (jy > 979) {
    gy = 1600;
    jy -= 979;
  } else {
    gy = 621;
  }

  let jDayNo =
    365 * jy +
    Math.floor(jy / 33) * 8 +
    Math.floor(((jy % 33) + 3) / 4) +
    78 +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);

  let gDayNo =
    80 + jDayNo;

  gy += 400 * Math.floor(gDayNo / 146097);
  gDayNo %= 146097;

  let leap = true;

  if (gDayNo >= 36525) {
    gDayNo--;

    gy += 100 * Math.floor(gDayNo / 36524);
    gDayNo %= 36524;

    if (gDayNo >= 365) {
      gDayNo++;
    } else {
      leap = false;
    }
  }

  gy += 4 * Math.floor(gDayNo / 1461);
  gDayNo %= 1461;

  if (gDayNo >= 366) {
    leap = false;
    gDayNo--;

    gy += Math.floor(gDayNo / 365);
    gDayNo %= 365;
  }

  const gd = gDayNo + 1;

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
  let remaining = gd;

  for (let i = 0; i < 12; i++) {
    if (remaining <= monthDays[i]) {
      gm = i + 1;
      break;
    }

    remaining -= monthDays[i];
  }

  return {
    gy,
    gm,
    gd: remaining
  };
}

function isRecentNews(item) {
  if (!item || !item.publishedAt) {
    return false;
  }

  const published = new Date(item.publishedAt);

  if (isNaN(published.getTime())) {
    return false;
  }

  const now = Date.now();
  const diff = now - published.getTime();

  /*
   * خبر آینده بیش از 6 ساعت نیز مشکوک است.
   */
  if (diff < -6 * 60 * 60 * 1000) {
    return false;
  }

  return diff <= MAX_AGE_HOURS * 60 * 60 * 1000;
}

/* -------------------------------------------------------
   تصویر
------------------------------------------------------- */

function extractImageFromHtml($, root, baseUrl) {
  const node = root || $.root();

  let image = '';

  const metaSelectors = [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="twitter:image"]'
  ];

  for (const selector of metaSelectors) {
    const value = node.find(selector).attr('content');

    if (value) {
      image = normalizeUrl(value, baseUrl);

      if (image) return image;
    }
  }

  const img = node.find('img').first().attr('src');

  if (img) {
    image = normalizeUrl(img, baseUrl);
  }

  return image || '';
}

function extractTelegramImage($, block) {
  let image = '';

  const photo = $(block)
    .find('.tgme_widget_message_photo_wrap')
    .first();

  if (photo.length) {
    const style = photo.attr('style') || '';

    const match = style.match(
      /background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i
    );

    if (match) {
      image = match[1];
    }

    if (!image) {
      image =
        photo.find('img').first().attr('src') ||
        photo.find('a').first().attr('href') ||
        '';
    }
  }

  if (!image) {
    image =
      $(block).find('img').first().attr('src') ||
      '';
  }

  return image || '';
}

/* -------------------------------------------------------
   نرمال‌سازی خبر
------------------------------------------------------- */

function makeId(title, link, sourceName) {
  return crypto
    .createHash('sha1')
    .update(
      normalizeText(
        `${title}|${link}|${sourceName}`
      )
    )
    .digest('hex');
}

function normalizeItem(raw, source) {
  const title = cleanNewsText(raw.title || '');

  const description = cleanNewsText(
    raw.description ||
    raw.content ||
    raw.text ||
    ''
  );

  const link = normalizeUrl(
    raw.link || raw.url || '',
    source.url
  );

  const image =
    raw.image ||
    raw.imageUrl ||
    '';

  const publishedAt =
    parseDate(
      raw.publishedAt ||
      raw.pubDate ||
      raw.date ||
      raw.published ||
      ''
    );

  if (!title) {
    return null;
  }

  const item = {
    id: makeId(
      title,
      link,
      source.name || source.id || ''
    ),
    title,
    description,
    link,
    image,
    imageUrl: image,
    sourceName: source.name || source.id || 'منبع خبری',
    sourceId: source.id || '',
    publishedAt: publishedAt
      ? publishedAt.toISOString()
      : null
  };

  return item;
}

/* -------------------------------------------------------
   فیلتر محلی
------------------------------------------------------- */

function containsAreaKeyword(text) {
  const value = normalizeText(text);

  return AREA_KEYWORDS.some(keyword =>
    value.includes(normalizeText(keyword))
  );
}

function containsForeignKeyword(text) {
  const value = normalizeText(text);

  return FOREIGN_KEYWORDS.some(keyword =>
    value.includes(normalizeText(keyword))
  );
}

function isLocalNews(item) {
  if (!item) return false;

  /*
   * بسیار مهم:
   * sourceName و URL عمداً در اینجا استفاده نمی‌شوند.
   *
   * بنابراین خبر ملی موجود در کانال هوراند،
   * صرفاً به دلیل اینکه از @horand_khabar آمده،
   * محلی محسوب نمی‌شود.
   */
  const text = normalizeText(
    `${item.title} ${item.description}`
  );

  return containsAreaKeyword(text);
}

function isForeignNews(item) {
  if (!item) return false;

  const text = normalizeText(
    `${item.title} ${item.description}`
  );

  /*
   * اگر خبر همزمان به منطقه هدف اشاره کند،
   * به صورت خودکار حذف نمی‌شود.
   */
  if (containsAreaKeyword(text)) {
    return false;
  }

  return containsForeignKeyword(text);
}

/* -------------------------------------------------------
   RSS
------------------------------------------------------- */

async function fetchRssSource(source) {
  try {
    const feed = await parser.parseURL(source.url);

    return (feed.items || [])
      .slice(0, MAX_ITEMS_PER_SOURCE)
      .map(item =>
        normalizeItem(
          {
            title: item.title,
            description:
              item.contentSnippet ||
              item.content ||
              item.summary ||
              '',
            link: item.link,
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

/* -------------------------------------------------------
   Google News
------------------------------------------------------- */

function buildGoogleUrl(source, language = 'fa', country = 'IR') {
  const keywords = source.keywords || [];

  const query =
    keywords.length > 0
      ? keywords[0]
      : source.name;

  return (
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(query) +
    `&hl=${language}&gl=${country}&ceid=${country}:${language}`
  );
}

async function fetchGoogleNewsSource(source) {
  const urls = [
    source.url,
    buildGoogleUrl(source, 'fa', 'IR'),
    buildGoogleUrl(source, 'en-US', 'US')
  ].filter(Boolean);

  for (const url of urls) {
    try {
      const feed = await parser.parseURL(url);

      const items = (feed.items || [])
        .slice(0, MAX_ITEMS_PER_SOURCE)
        .map(item =>
          normalizeItem(
            {
              title: item.title,
              description:
                item.contentSnippet ||
                item.content ||
                item.summary ||
                '',
              link: item.link,
              publishedAt:
                item.isoDate ||
                item.pubDate ||
                ''
            },
            source
          )
        )
        .filter(Boolean);

      if (items.length) {
        return items;
      }
    } catch (error) {
      console.log(
        `⚠️ Google News ${source.name}: ${error.message}`
      );
    }
  }

  return [];
}

/* -------------------------------------------------------
   Telegram
------------------------------------------------------- */

function extractTelegramPost(block, source) {
  const $ = cheerio.load(
    `<div id="telegram-root"></div>`
  );

  const html = cheerio.load(
    `<div class="root">${block}</div>`
  );

  const root = html('.root');

  const text = cleanNewsText(
    root.find('.tgme_widget_message_text').text() ||
    root.text()
  );

  const timeElement =
    root.find('.tgme_widget_message_date time[datetime]').first();

  const datetime =
    timeElement.attr('datetime') ||
    root.find('time[datetime]').first().attr('datetime') ||
    '';

  const date = parseDate(datetime);

  const dateLink =
    root
      .find('.tgme_widget_message_date')
      .first()
      .attr('href') ||
    '';

  const image = extractTelegramImage(
    html,
    root
  );

  /*
   * عنوان را از اولین خط معنادار متن می‌گیریم.
   */
  let lines = text
    .split(/\n+/)
    .map(x => x.trim())
    .filter(Boolean);

  lines = lines.filter(line => {
    if (/^🆔/.test(line)) return false;
    if (/^instagram\.com/i.test(line)) return false;
    if (/^@horand/i.test(line)) return false;
    return true;
  });

  const title =
    lines[0] ||
    'خبر جدید';

  const description =
    lines.slice(1).join(' ').trim();

  return normalizeItem(
    {
      title,
      description,
      text,
      link: dateLink,
      image,
      publishedAt: date
    },
    source
  );
}

async function fetchTelegramSource(source) {
  try {
    const result = await httpGet(source.url);

    const $ = cheerio.load(result.body);

    const blocks =
      $('.tgme_widget_message').toArray();

    if (!blocks.length) {
      console.log(
        `⚠️ تلگرام ${source.name}: پیام قابل پردازش پیدا نشد.`
      );

      return [];
    }

    return blocks
      .slice(-MAX_ITEMS_PER_SOURCE)
      .map(block =>
        extractTelegramPost(
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

/* -------------------------------------------------------
   HTML / Tasnim
------------------------------------------------------- */

function findArticleLinks($, baseUrl) {
  const links = [];
  const seen = new Set();

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');

    if (!href) return;

    const absolute = normalizeUrl(
      href,
      baseUrl
    );

    if (!absolute) return;

    /*
     * لینک مقاله‌های خبری تسنیم
     */
    if (
      !/\/fa\/news\//i.test(absolute)
    ) {
      return;
    }

    if (seen.has(absolute)) {
      return;
    }

    seen.add(absolute);
    links.push(absolute);
  });

  return links.slice(
    0,
    Math.max(MAX_ITEMS_PER_SOURCE, 15)
  );
}

function extractArticleDate($) {
  const selectors = [
    'time[datetime]',
    'meta[property="article:published_time"]',
    'meta[name="publish-date"]',
    'meta[name="date"]',
    '[itemprop="datePublished"]'
  ];

  for (const selector of selectors) {
    const element = $(selector).first();

    if (!element.length) continue;

    const value =
      element.attr('datetime') ||
      element.attr('content') ||
      element.text();

    const parsed = parseDate(value);

    if (parsed) {
      return parsed;
    }
  }

  const bodyText = $('body').text();

  const match = bodyText.match(
    /(\d{4}\/\d{1,2}\/\d{1,2})\s*[-–]\s*(\d{1,2}:\d{2})/
  );

  if (match) {
    return parseDate(
      `${match[1]} ${match[2]}`
    );
  }

  return null;
}

function extractArticleBody($) {
  const selectors = [
    'article',
    '.story-content',
    '.news-content',
    '.article-content',
    '.content',
    '.story',
    '[itemprop="articleBody"]'
  ];

  for (const selector of selectors) {
    const element = $(selector).first();

    if (!element.length) continue;

    const text = cleanNewsText(
      element.text()
    );

    if (text.length >= 80) {
      return text.substring(0, 4000);
    }
  }

  /*
   * fallback
   */
  const paragraphs = [];

  $('p').each((_, element) => {
    const text = cleanNewsText(
      $(element).text()
    );

    if (text.length >= 30) {
      paragraphs.push(text);
    }
  });

  return paragraphs
    .join(' ')
    .substring(0, 4000);
}

async function fetchArticlePage(url, source) {
  try {
    const result = await httpGet(url);

    const $ = cheerio.load(result.body);

    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('h1').first().text() ||
      $('title').text();

    const description =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      '';

    const image =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      '';

    const publishedAt =
      extractArticleDate($);

    const body =
      extractArticleBody($);

    return normalizeItem(
      {
        title: decodeEntities(title),
        description:
          cleanNewsText(description) ||
          body,
        link: url,
        image: normalizeUrl(image, url),
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

async function fetchHtmlSource(source) {
  try {
    const result = await httpGet(source.url);

    const $ = cheerio.load(result.body);

    const articleLinks =
      findArticleLinks(
        $,
        source.url
      );

    if (!articleLinks.length) {
      console.log(
        `⚠️ ${source.name}: لینک مقاله پیدا نشد.`
      );

      return [];
    }

    const results = [];

    /*
     * همزمانی محدود برای جلوگیری از فشار زیاد
     */
    const batchSize = 4;

    for (
      let i = 0;
      i < articleLinks.length;
      i += batchSize
    ) {
      const batch =
        articleLinks.slice(
          i,
          i + batchSize
        );

      const batchResults =
        await Promise.all(
          batch.map(url =>
            fetchArticlePage(
              url,
              source
            )
          )
        );

      for (const item of batchResults) {
        if (item) {
          results.push(item);
        }
      }
    }

    return results;
  } catch (error) {
    console.log(
      `❌ HTML ${source.name}: ${error.message}`
    );

    return [];
  }
}

/* -------------------------------------------------------
   منبع
------------------------------------------------------- */

async function fetchSource(source) {
  console.log(
    `\n🔎 دریافت: ${source.name}`
  );

  console.log(
    `   URL: ${source.url}`
  );

  let items = [];

  const type =
    String(source.type || 'rss')
      .toLowerCase()
      .trim();

  if (
    type === 'google-news' ||
    (
      type === 'rss' &&
      String(source.id || '').startsWith('google-')
    )
  ) {
    items =
      await fetchGoogleNewsSource(
        source
      );
  } else if (type === 'telegram') {
    items =
      await fetchTelegramSource(
        source
      );
  } else if (type === 'html') {
    items =
      await fetchHtmlSource(
        source
      );
  } else if (type === 'rss') {
    items =
      await fetchRssSource(
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

/* -------------------------------------------------------
   حذف تکراری
------------------------------------------------------- */

function normalizeTitleForCompare(title) {
  return normalizeText(title)
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(
      /\b(ایسنا|ایرنا|تسنیم|فارس|مهر|تابناک)\b/gi,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a, b) {
  const x = normalizeTitleForCompare(a);
  const y = normalizeTitleForCompare(b);

  if (!x || !y) return 0;

  if (x === y) return 1;

  const xWords = new Set(x.split(' '));
  const yWords = new Set(y.split(' '));

  let common = 0;

  for (const word of xWords) {
    if (word.length >= 2 && yWords.has(word)) {
      common++;
    }
  }

  const total =
    new Set([
      ...xWords,
      ...yWords
    ]).size;

  return total
    ? common / total
    : 0;
}

function uniqueItems(items) {
  const result = [];
  const links = new Set();

  for (const item of items) {
    if (!item) continue;

    if (
      item.link &&
      links.has(item.link)
    ) {
      continue;
    }

    let duplicate = false;

    for (const old of result) {
      if (
        similarity(
          item.title,
          old.title
        ) >= 0.82
      ) {
        duplicate = true;
        break;
      }
    }

    if (duplicate) {
      continue;
    }

    if (item.link) {
      links.add(item.link);
    }

    result.push(item);
  }

  return result;
}

/* -------------------------------------------------------
   جمع کل اخبار
------------------------------------------------------- */

async function fetchAllNews() {
  const sources =
    await loadSources();

  const all = [];

  console.log(
    `\n📡 تعداد منابع فعال: ${sources.length}`
  );

  for (const source of sources) {
    try {
      const items =
        await fetchSource(source);

      all.push(...items);
    } catch (error) {
      console.log(
        `❌ خطا در منبع ${source.name}: ${error.message}`
      );
    }
  }

  console.log(
    `\n📦 مجموع خام: ${all.length}`
  );

  const unique =
    uniqueItems(all);

  console.log(
    `♻️ پس از حذف تکراری: ${unique.length}`
  );

  const recent =
    unique.filter(isRecentNews);

  console.log(
    `⏱️ پس از فیلتر ${MAX_AGE_HOURS} ساعته: ${recent.length}`
  );

  const local =
    recent.filter(isLocalNews);

  console.log(
    `📍 پس از فیلتر محلی: ${local.length}`
  );

  const clean =
    local.filter(
      item => !isForeignNews(item)
    );

  console.log(
    `🌍 پس از فیلتر خبر غیرمحلی: ${clean.length}`
  );

  clean.sort((a, b) => {
    return (
      new Date(b.publishedAt).getTime() -
      new Date(a.publishedAt).getTime()
    );
  });

  const maxTotal =
    Number(
      process.env.MAX_TOTAL_ITEMS || 30
    );

  return clean.slice(
    0,
    maxTotal
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
  cleanNewsText
};

---

2) "src/formatter.js"

'use strict';

const CHANNEL_ID = '@arrasbarannews';

function toPersianDigits(value) {
  return String(value)
    .replace(/0/g, '۰')
    .replace(/1/g, '۱')
    .replace(/2/g, '۲')
    .replace(/3/g, '۳')
    .replace(/4/g, '۴')
    .replace(/5/g, '۵')
    .replace(/6/g, '۶')
    .replace(/7/g, '۷')
    .replace(/8/g, '۸')
    .replace(/9/g, '۹');
}

function cleanText(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/www\.\S+/gi, '')
    .replace(/instagram\.com\/\S+/gi, '')
    .replace(/t\.me\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(title) {
  let value = cleanText(title);

  value = value
    .replace(/\s*[-|]\s*(تسنیم|ایرنا|ایسنا|فارس|مهر)\s*$/i, '')
    .replace(/\s*\|\s*[^|]+$/i, '')
    .trim();

  return value;
}

function formatPersianDate(date, timezone) {
  return toPersianDigits(
    new Intl.DateTimeFormat(
      'fa-IR-u-ca-persian',
      {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }
    ).format(date)
  );
}

function formatPersianTime(date, timezone) {
  return toPersianDigits(
    new Intl.DateTimeFormat(
      'fa-IR',
      {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }
    ).format(date)
  );
}

function sourceLabel(sourceName) {
  const name = cleanText(sourceName);

  if (!name) {
    return '';
  }

  if (/^google news/i.test(name)) {
    return '';
  }

  return `به گزارش اخبار ارسباران به نقل از ${name}`;
}

function makeSummary(text, maxLength) {
  let value = cleanText(text);

  value = value
    .replace(/^به گزارش[^:：]*[:：]\s*/i, '')
    .replace(/^طبق گزارش[^:：]*[:：]\s*/i, '')
    .replace(/^به نقل از[^:：]*[:：]\s*/i, '')
    .trim();

  if (!value) {
    return '';
  }

  if (value.length <= maxLength) {
    return value;
  }

  let cut = value.substring(
    0,
    maxLength
  );

  const lastSpace =
    cut.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.75) {
    cut = cut.substring(
      0,
      lastSpace
    );
  }

  return `${cut}…`;
}

function formatNews(item, options = {}) {
  const timezone =
    options.timezone ||
    'Asia/Tehran';

  const forPhoto =
    options.forPhoto !== false &&
    !!item.imageUrl;

  const title =
    cleanTitle(item.title) ||
    'خبر جدید';

  const description =
    makeSummary(
      item.description,
      forPhoto ? 560 : 1000
    );

  const source =
    sourceLabel(
      item.sourceName
    );

  let publishedAt = null;

  if (item.publishedAt) {
    const d =
      new Date(item.publishedAt);

    if (!isNaN(d.getTime())) {
      publishedAt = d;
    }
  }

  /*
   * هرگز تاریخ فعلی را جایگزین تاریخ خبر نمی‌کنیم.
   */
  if (!publishedAt) {
    return '';
  }

  const date =
    formatPersianDate(
      publishedAt,
      timezone
    );

  const time =
    formatPersianTime(
      publishedAt,
      timezone
    );

  const parts = [];

  parts.push(
    `📰 ${title}`
  );

  if (source) {
    parts.push(source);
  }

  if (description) {
    parts.push(description);
  }

  parts.push(
    `🕐 ${date} - ${time}`
  );

  parts.push(
    CHANNEL_ID
  );

  let text =
    parts.join('\n\n').trim();

  /*
   * محدودیت Caption تلگرام 1024 کاراکتر است.
   * کمی حاشیه امن نگه می‌داریم.
   */
  if (forPhoto && text.length > 950) {
    const fixedParts = [
      `📰 ${title}`,
      source,
      makeSummary(
        item.description,
        500
      ),
      `🕐 ${date} - ${time}`,
      CHANNEL_ID
    ].filter(Boolean);

    text =
      fixedParts
        .join('\n\n')
        .trim();

    if (text.length > 950) {
      text =
        text.substring(0, 947) +
        '…';
    }
  }

  return text;
}

module.exports = {
  formatNews,
  formatPersianDate,
  formatPersianTime,
  toPersianDigits
};

---

3) "src/telegram.js"

'use strict';

const http = require('http');
const https = require('https');

const TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const API =
  `https://api.telegram.org/bot${TOKEN}`;

function telegramRequest(
  method,
  payload
) {
  return new Promise(
    (resolve, reject) => {
      const url =
        new URL(`${API}/${method}`);

      const body =
        JSON.stringify(payload);

      const req =
        https.request(
          {
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
              'Content-Length':
                Buffer.byteLength(body)
            },
            timeout: 30000
          },
          res => {
            let data = '';

            res.on(
              'data',
              chunk => {
                data += chunk;
              }
            );

            res.on(
              'end',
              () => {
                try {
                  const json =
                    JSON.parse(data);

                  if (!json.ok) {
                    reject(
                      new Error(
                        json.description ||
                        `Telegram API ${res.statusCode}`
                      )
                    );
                    return;
                  }

                  resolve(
                    json.result
                  );
                } catch (error) {
                  reject(error);
                }
              }
            );
          }
        );

      req.on(
        'timeout',
        () => {
          req.destroy(
            new Error(
              'Telegram request timeout'
            )
          );
        }
      );

      req.on(
        'error',
        reject
      );

      req.write(body);
      req.end();
    }
  );
}

function downloadBuffer(
  url,
  redirects = 0
) {
  return new Promise(
    (resolve, reject) => {
      if (redirects > 6) {
        reject(
          new Error(
            'Redirect limit exceeded'
          )
        );
        return;
      }

      let parsed;

      try {
        parsed =
          new URL(url);
      } catch {
        reject(
          new Error(
            'URL تصویر نامعتبر است'
          )
        );
        return;
      }

      const client =
        parsed.protocol === 'https:'
          ? https
          : http;

      const req =
        client.request(
          parsed,
          {
            method: 'GET',
            timeout: 30000,
            headers: {
              'User-Agent':
                'Mozilla/5.0',
              Accept:
                'image/avif,image/webp,image/apng,image/*,*/*'
            }
          },
          res => {
            const status =
              res.statusCode || 0;

            if (
              [301,302,303,307,308]
                .includes(status) &&
              res.headers.location
            ) {
              res.resume();

              const next =
                new URL(
                  res.headers.location,
                  url
                ).href;

              downloadBuffer(
                next,
                redirects + 1
              )
                .then(resolve)
                .catch(reject);

              return;
            }

            if (
              status < 200 ||
              status >= 400
            ) {
              res.resume();

              reject(
                new Error(
                  `Image HTTP ${status}`
                )
              );

              return;
            }

            const chunks = [];

            res.on(
              'data',
              chunk =>
                chunks.push(chunk)
            );

            res.on(
              'end',
              () => {
                resolve({
                  buffer:
                    Buffer.concat(chunks),
                  contentType:
                    res.headers[
                      'content-type'
                    ] || 'image/jpeg'
                });
              }
            );
          }
        );

      req.on(
        'timeout',
        () => {
          req.destroy(
            new Error(
              'Image download timeout'
            )
          );
        }
      );

      req.on(
        'error',
        reject
      );

      req.end();
    }
  );
}

function multipartTelegramRequest(
  method,
  fields,
  fileField,
  fileBuffer,
  fileName,
  contentType
) {
  return new Promise(
    (resolve, reject) => {
      const boundary =
        `----ArasbaranBot${Date.now()}`;

      const chunks = [];

      for (
        const [key, value]
        of Object.entries(fields)
      ) {
        chunks.push(
          Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
            `${String(value)}\r\n`
          )
        );
      }

      chunks.push(
        Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\n` +
          `Content-Type: ${contentType || 'image/jpeg'}\r\n\r\n`
        )
      );

      chunks.push(fileBuffer);

      chunks.push(
        Buffer.from(
          `\r\n--${boundary}--\r\n`
        )
      );

      const body =
        Buffer.concat(chunks);

      const url =
        new URL(
          `${API}/${method}`
        );

      const req =
        https.request(
          {
            hostname:
              url.hostname,
            path:
              url.pathname,
            method:
              'POST',
            headers: {
              'Content-Type':
                `multipart/form-data; boundary=${boundary}`,
              'Content-Length':
                body.length
            },
            timeout: 60000
          },
          res => {
            let data = '';

            res.on(
              'data',
              chunk => {
                data += chunk;
              }
            );

            res.on(
              'end',
              () => {
                try {
                  const json =
                    JSON.parse(data);

                  if (!json.ok) {
                    reject(
                      new Error(
                        json.description ||
                        `Telegram ${res.statusCode}`
                      )
                    );
                    return;
                  }

                  resolve(
                    json.result
                  );
                } catch (error) {
                  reject(error);
                }
              }
            );
          }
        );

      req.on(
        'timeout',
        () => {
          req.destroy(
            new Error(
              'Multipart timeout'
            )
          );
        }
      );

      req.on(
        'error',
        reject
      );

      req.write(body);
      req.end();
    }
  );
}

async function getMe() {
  return telegramRequest(
    'getMe',
    {}
  );
}

async function sendMessage(text) {
  const chatId =
    process.env.TELEGRAM_CHANNEL_ID;

  if (!chatId) {
    throw new Error(
      'TELEGRAM_CHANNEL_ID تنظیم نشده است.'
    );
  }

  return telegramRequest(
    'sendMessage',
    {
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    }
  );
}

async function sendPhoto(
  photo,
  caption = ''
) {
  const chatId =
    process.env.TELEGRAM_CHANNEL_ID;

  if (!chatId) {
    throw new Error(
      'TELEGRAM_CHANNEL_ID تنظیم نشده است.'
    );
  }

  /*
   * اول URL مستقیم را امتحان می‌کنیم.
   */
  try {
    return await telegramRequest(
      'sendPhoto',
      {
        chat_id: chatId,
        photo,
        caption
      }
    );
  } catch (firstError) {
    console.log(
      `⚠️ ارسال مستقیم تصویر ناموفق بود: ${firstError.message}`
    );

    /*
     * اگر تلگرام نتوانست URL را بخواند،
     * خودمان تصویر را دانلود و به صورت فایل آپلود می‌کنیم.
     */
    const downloaded =
      await downloadBuffer(photo);

    return multipartTelegramRequest(
      'sendPhoto',
      {
        chat_id: chatId,
        caption
      },
      'photo',
      downloaded.buffer,
      'news.jpg',
      downloaded.contentType
    );
  }
}

async function sendVideo(
  video,
  caption = ''
) {
  const chatId =
    process.env.TELEGRAM_CHANNEL_ID;

  return telegramRequest(
    'sendVideo',
    {
      chat_id: chatId,
      video,
      caption
    }
  );
}

module.exports = {
  getMe,
  sendMessage,
  sendPhoto,
  sendVideo,
  telegramRequest
};

---

4) "src/index.js"

'use strict';

require('dotenv').config();

const {
  fetchAllNews
} = require('./news');

const {
  formatNews
} = require('./formatter');

const {
  getMe,
  sendMessage,
  sendPhoto,
  sendVideo
} = require('./telegram');

const {
  hasNews,
  saveNews
} = require('./storage');

const CONFIG = {
  timezone:
    process.env.TIMEZONE ||
    'Asia/Tehran'
};

async function sendNewsItem(
  item,
  message
) {
  /*
   * اول تصویر
   */
  if (item.imageUrl) {
    try {
      await sendPhoto(
        item.imageUrl,
        message
      );

      return 'photo';
    } catch (error) {
      console.log(
        `⚠️ ارسال تصویر شکست خورد: ${error.message}`
      );
    }
  }

  /*
   * ویدئو
   */
  if (item.videoUrl) {
    try {
      await sendVideo(
        item.videoUrl,
        message
      );

      return 'video';
    } catch (error) {
      console.log(
        `⚠️ ارسال ویدئو شکست خورد: ${error.message}`
      );
    }
  }

  /*
   * فقط اگر تصویر و ویدئو قابل ارسال نبودند،
   * متن را ارسال می‌کنیم.
   */
  await sendMessage(message);

  return 'text';
}

async function main() {
  console.log(
    '\n========================================'
  );

  console.log(
    '🇮🇷 ARASBARAN NEWS BOT'
  );

  console.log(
    '========================================\n'
  );

  const me =
    await getMe();

  console.log(
    `🤖 Bot: @${me.username || me.first_name}`
  );

  const news =
    await fetchAllNews();

  console.log(
    `\n📰 اخبار نهایی: ${news.length}`
  );

  if (!news.length) {
    console.log(
      'ℹ️ هیچ خبر جدید و معتبر محلی در بازه زمانی تعیین‌شده پیدا نشد.'
    );

    return;
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (
    const item of news
  ) {
    const id =
      item.id;

    if (!id) {
      console.log(
        '⚠️ خبر بدون ID رد شد.'
      );

      continue;
    }

    if (hasNews(id)) {
      skipped++;

      console.log(
        `↩️ تکراری: ${item.title}`
      );

      continue;
    }

    /*
     * خبر بدون تاریخ نباید به این مرحله برسد.
     * این کنترل نهایی برای اطمینان است.
     */
    if (!item.publishedAt) {
      console.log(
        `⛔ بدون تاریخ: ${item.title}`
      );

      continue;
    }

    const message =
      formatNews(
        item,
        {
          timezone:
            CONFIG.timezone,
          forPhoto:
            !!item.imageUrl
        }
      );

    if (!message) {
      console.log(
        `⛔ متن خبر قابل تولید نیست: ${item.title}`
      );

      continue;
    }

    console.log(
      '\n----------------------------------------'
    );

    console.log(
      `📰 ${item.title}`
    );

    console.log(
      `📅 ${item.publishedAt}`
    );

    console.log(
      `🖼️ ${item.imageUrl || 'بدون تصویر'}`
    );

    console.log(
      `🔗 ${item.link || 'بدون لینک'}`
    );

    try {
      const type =
        await sendNewsItem(
          item,
          message
        );

      saveNews(id);

      sent++;

      console.log(
        `✅ ارسال شد: ${type}`
      );

      /*
       * فاصله کوتاه بین ارسال‌ها
       */
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            1200
          )
      );
    } catch (error) {
      failed++;

      console.log(
        `❌ خطا در ارسال: ${error.message}`
      );
    }
  }

  console.log(
    '\n========================================'
  );

  console.log(
    `✅ ارسال موفق: ${sent}`
  );

  console.log(
    `↩️ تکراری: ${skipped}`
  );

  console.log(
    `❌ خطا: ${failed}`
  );

  console.log(
    '========================================'
  );
}

main().catch(error => {
  console.error(
    '\n💥 خطای اصلی:',
    error
  );

  process.exit(1);
});

نکته مهم درباره "config/sources.json"

ساختار فعلی "sources.json" را نگه دار؛ فقط برای هوراند همین تنظیم کافی است:

{
  "id": "telegram-horand",
  "name": "هوراند خبر",
  "type": "telegram",
  "url": "https://t.me/s/horand_khabar",
  "keywords": [
    "هوراند",
    "کلیبر",
    "خداآفرین",
    "ارسباران"
  ],
  "enabled": true
}

در نسخه جدید، "keywords" منبع به‌تنهایی باعث محلی شناخته‌شدن خبر نمی‌شود؛ متن واقعی عنوان و توضیحات باید نشانه‌ای از منطقه داشته باشد. این موضوع برای "هوراند خبر" مهم است، چون این کانال علاوه بر اخبار هوراند، مطالب ملی و سیاسی هم منتشر می‌کند.

نتیجه این نسخه

- ❌ خبر بدون تاریخ → ارسال نمی‌شود
- ❌ خبر قدیمی‌تر از ۴۸ ساعت → ارسال نمی‌شود
- ❌ خبر ملی از کانال هوراند → ارسال نمی‌شود
- ❌ لینک خبر در متن کانال → نمایش داده نمی‌شود
- ❌ تاریخ نامعلوم → به تاریخ امروز تبدیل نمی‌شود
- ✅ تاریخ خبر → تاریخ واقعی خبر
- ✅ ساعت → به وقت تهران و فارسی
- ✅ تصویر → ابتدا ارسال مستقیم، در صورت شکست دانلود و آپلود واقعی به تلگرام
- ✅ Tasnim → صفحه فهرست → ورود به مقاله اصلی → استخراج تاریخ، متن و تصویر
- ✅ خبرهای مشابه از چند منبع → حذف تکراری
- ✅ خلاصه خبر → مناسب Caption تلگرام
- ✅ نام منبع → در متن خبر
- ✅ "@horand_khabar" → فقط خبرهای واقعاً مرتبط با ارسباران/هوراند و مناطق هدف عبور می‌کنند

یک نکته مهم برای تست: چون "data/news-history.json" خبرهای قبلی را نگه می‌دارد، اگر بخواهی همین اخبار ۴۸ ساعت اخیر را دوباره برای آزمایش ارسال کنی، باید رکوردهای قبلی را از فایل تاریخچه پاک کنی؛ در غیر این صورت ربات آن‌ها را عمداً تکراری تشخیص می‌دهد.
