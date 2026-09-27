'use strict';

const Parser = require('rss-parser');
const https = require('https');
const http = require('http');
const cheerio = require('cheerio');

const { loadSources } = require('./sources');

const parser = new Parser({
  timeout: 30000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  }
});

const LOCAL_KEYWORDS = [
  'ورزقان',
  'خاروانا',
  'اهر',
  'کلیبر',
  'هوراند',
  'خداآفرین',
  'ارسباران',
  'سونگون',
  'قره داغ',
  'قره‌داغ'
];

const FOREIGN_KEYWORDS = [
  'bbc',
  'afghanistan international',
  'afghanistan',
  'pakistan',
  'ukraine',
  'russia',
  'israel',
  'america',
  'american',
  'trump',
  'europe',
  'غزه',
  'اسرائیل',
  'اوکراین',
  'افغانستان',
  'پاکستان'
];

function normalizeText(value) {
  if (!value) return '';

  return String(value)
    .replace(/ي/g, 'ی')
    .replace(/ى/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanHtml(value) {
  if (!value) return '';

  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(base, value) {
  if (!value) return '';

  try {
    return new URL(value, base).href;
  } catch (error) {
    return '';
  }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    let parsed;

    try {
      parsed = new URL(url);
    } catch (error) {
      reject(new Error(`URL نامعتبر: ${url}`));
      return;
    }

    const client =
      parsed.protocol === 'https:'
        ? https
        : http;

    const request = client.get(
      parsed,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 ArasbaranNewsBot/2.0',
          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language':
            'fa-IR,fa;q=0.9,en;q=0.5'
        }
      },
      response => {
        let body = '';

        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          const nextUrl = absoluteUrl(
            url,
            response.headers.location
          );

          httpGet(nextUrl)
            .then(resolve)
            .catch(reject);

          return;
        }

        response.setEncoding('utf8');

        response.on('data', chunk => {
          body += chunk;
        });

        response.on('end', () => {
          console.log(
            `HTTP ${response.statusCode} | ${url} | ${body.length} bytes`
          );

          if (
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            reject(
              new Error(
                `HTTP ${response.statusCode}`
              )
            );
            return;
          }

          resolve(body);
        });
      }
    );

    request.setTimeout(30000, () => {
      request.destroy(
        new Error('HTTP timeout')
      );
    });

    request.on('error', reject);
  });
}

function parseDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (!Number.isNaN(date.getTime())) {
    return date;
  }

  return null;
}

function normalizeItem(item, source) {
  const title = cleanHtml(
    item.title ||
      item.name ||
      'خبر جدید'
  );

  const description = cleanHtml(
    item.description ||
      item.content ||
      item.summary ||
      ''
  );

  const link =
    item.link ||
    item.url ||
    '';

  const publishedAt =
    item.publishedAt ||
    item.pubDate ||
    item.isoDate ||
    null;

  const imageUrl =
    item.imageUrl ||
    item.image ||
    '';

  return {
    id: String(
      item.id ||
      item.guid ||
      link ||
      `${source.id}:${title}`
    ),

    sourceId: source.id,

    sourceName:
      item.sourceName ||
      source.name,

    title: title.trim(),

    description:
      description.trim(),

    link,

    publishedAt,

    imageUrl,

    videoUrl:
      item.videoUrl ||
      '',

    areas:
      Array.isArray(source.areas)
        ? source.areas
        : []
  };
}

/* =========================================================
   RSS
   ========================================================= */

async function fetchRssSource(source) {
  console.log(
    `📡 RSS شروع: ${source.name}`
  );

  console.log(
    `   URL: ${source.url}`
  );

  try {
    const feed =
      await parser.parseURL(source.url);

    const items =
      Array.isArray(feed.items)
        ? feed.items
        : [];

    console.log(
      `✅ RSS نتیجه: ${source.name} = ${items.length}`
    );

    return items.map(item =>
      normalizeItem(
        {
          id:
            item.guid ||
            item.id ||
            item.link,

          title:
            item.title,

          description:
            item.contentSnippet ||
            item.content ||
            item.summary,

          link:
            item.link,

          publishedAt:
            item.isoDate ||
            item.pubDate,

          imageUrl:
            item.enclosure &&
            item.enclosure.url,

          sourceName:
            source.name
        },
        source
      )
    );
  } catch (error) {
    console.error(
      `❌ RSS خطا: ${source.name}`
    );

    console.error(
      `   ${error.message}`
    );

    return [];
  }
}

/* =========================================================
   HTML
   ========================================================= */

function extractDate($) {
  const selectors = [
    'meta[property="article:published_time"]',
    'meta[name="date"]',
    'meta[name="pubdate"]',
    'meta[itemprop="datePublished"]',
    'time[datetime]'
  ];

  for (const selector of selectors) {
    const element =
      $(selector).first();

    if (!element.length) continue;

    const values = [
      element.attr('datetime'),
      element.attr('content'),
      element.text()
    ];

    for (const value of values) {
      const date =
        parseDate(value);

      if (date) {
        return date;
      }
    }
  }

  return null;
}

function extractImage($, baseUrl) {
  const selectors = [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[itemprop="image"]'
  ];

  for (const selector of selectors) {
    const value =
      $(selector).attr('content');

    if (value) {
      return absoluteUrl(
        baseUrl,
        value
      );
    }
  }

  return '';
}

function extractDescription($) {
  const values = [
    $('meta[property="og:description"]')
      .attr('content'),

    $('meta[name="description"]')
      .attr('content'),

    $('article')
      .first()
      .text(),

    $('main')
      .first()
      .text()
  ];

  for (const value of values) {
    const clean =
      cleanHtml(value);

    if (clean.length > 20) {
      return clean.substring(
        0,
        1500
      );
    }
  }

  return '';
}

async function fetchHtmlSource(source) {
  console.log(
    `🌐 HTML شروع: ${source.name}`
  );

  console.log(
    `   URL: ${source.url}`
  );

  try {
    const html =
      await httpGet(source.url);

    console.log(
      `   HTML دریافت شد: ${html.length} bytes`
    );

    const $ =
      cheerio.load(html);

    const candidates = [];

    $('a[href]').each(
      (index, element) => {
        const title =
          cleanHtml(
            $(element).text()
          );

        const href =
          $(element).attr('href');

        if (!title || !href) {
          return;
        }

        if (
          title.length < 15 ||
          title.length > 250
        ) {
          return;
        }

        const url =
          absoluteUrl(
            source.url,
            href
          );

        if (!url) return;

        if (
          candidates.some(
            item =>
              item.url === url
          )
        ) {
          return;
        }

        candidates.push({
          title,
          url
        });
      }
    );

    console.log(
      `   لینک‌های خبری احتمالی: ${candidates.length}`
    );

    const results = [];

    const limit =
      Number(
        source.maxItems || 20
      );

    for (
      const candidate of
      candidates.slice(0, limit)
    ) {
      try {
        const article =
          await fetchArticle(
            candidate.url,
            source,
            candidate.title
          );

        if (article) {
          results.push(article);
        }
      } catch (error) {
        console.log(
          `   ⚠️ مقاله رد شد: ${candidate.url}`
        );

        console.log(
          `      ${error.message}`
        );
      }
    }

    console.log(
      `✅ HTML نتیجه: ${source.name} = ${results.length}`
    );

    return results;
  } catch (error) {
    console.error(
      `❌ HTML خطا: ${source.name}`
    );

    console.error(
      `   ${error.message}`
    );

    return [];
  }
}

async function fetchArticle(
  url,
  source,
  fallbackTitle
) {
  const html =
    await httpGet(url);

  const $ =
    cheerio.load(html);

  let title =
    $('meta[property="og:title"]')
      .attr('content') ||

    $('h1')
      .first()
      .text() ||

    fallbackTitle ||

    $('title')
      .first()
      .text();

  title =
    cleanHtml(title);

  if (!title) {
    return null;
  }

  const description =
    extractDescription($);

  const date =
    extractDate($);

  const imageUrl =
    extractImage(
      $,
      url
    );

  const canonical =
    $('link[rel="canonical"]')
      .attr('href');

  const link =
    absoluteUrl(
      url,
      canonical
    ) || url;

  return normalizeItem(
    {
      id: link,
      title,
      description,
      link,
      publishedAt:
        date
          ? date.toISOString()
          : null,
      imageUrl,
      sourceName:
        source.name
    },
    source
  );
}

/* =========================================================
   FILTERS
   ========================================================= */

function isRecentNews(
  item,
  hours = 48
) {
  if (!item.publishedAt) {
    console.log(
      `⚠️ بدون تاریخ: ${item.title}`
    );

    return false;
  }

  const time =
    new Date(
      item.publishedAt
    ).getTime();

  if (Number.isNaN(time)) {
    return false;
  }

  const age =
    (
      Date.now() -
      time
    ) /
    3600000;

  return (
    age >= -3 &&
    age <= hours
  );
}

function isLocalNews(item) {
  const text =
    normalizeText(
      `${item.title} ${item.description} ${item.sourceName}`
    ).toLowerCase();

  return LOCAL_KEYWORDS.some(
    keyword =>
      text.includes(
        normalizeText(
          keyword
        ).toLowerCase()
      )
  );
}

function isForeignNews(item) {
  const text =
    normalizeText(
      `${item.title} ${item.description}`
    ).toLowerCase();

  return FOREIGN_KEYWORDS.some(
    keyword =>
      text.includes(
        normalizeText(
          keyword
        ).toLowerCase()
      )
  );
}

function deduplicate(items) {
  const map =
    new Map();

  for (const item of items) {
    const key =
      item.link ||
      item.id ||
      item.title;

    if (!map.has(key)) {
      map.set(
        key,
        item
      );
    }
  }

  return Array.from(
    map.values()
  );
}

/* =========================================================
   MAIN
   ========================================================= */

async function fetchAllNews() {
  const sources =
    loadSources();

  console.log(
    '================================'
  );

  console.log(
    `تعداد منابع فعال: ${sources.length}`
  );

  console.log(
    '================================'
  );

  let rawItems = [];

  for (const source of sources) {
    console.log(
      `در حال دریافت: ${source.name}`
    );

    let items = [];

    try {
      items =
        await fetchSource(
          source
        );
    } catch (error) {
      console.error(
        `❌ خطای منبع ${source.name}:`,
        error.message
      );
    }

    console.log(
      `   نتیجه ${source.name}: ${items.length}`
    );

    rawItems =
      rawItems.concat(
        items
      );
  }

  console.log(
    `کل اخبار خام: ${rawItems.length}`
  );

  const unique =
    deduplicate(
      rawItems
    );

  console.log(
    `بعد از حذف تکراری: ${unique.length}`
  );

  const recent =
    unique.filter(item => {
      const ok =
        isRecentNews(
          item,
          48
        );

      if (!ok) {
        console.log(
          `⏰ قدیمی/نامعتبر: ${item.title}`
        );
      }

      return ok;
    });

  console.log(
    `بعد از فیلتر 48 ساعت: ${recent.length}`
  );

  const local =
    recent.filter(
      isLocalNews
    );

  console.log(
    `بعد از فیلتر محلی: ${local.length}`
  );

  const nonForeign =
    local.filter(
      item =>
        !isForeignNews(item)
    );

  console.log(
    `بعد از حذف منابع خارجی: ${nonForeign.length}`
  );

  nonForeign.sort(
    (a, b) =>
      new Date(
        b.publishedAt
      ) -
      new Date(
        a.publishedAt
      )
  );

  const max =
    Number(
      process.env.MAX_TOTAL_ITEMS ||
      30
    );

  const finalItems =
    nonForeign.slice(
      0,
      max
    );

  console.log(
    `تعداد اخبار نهایی: ${finalItems.length}`
  );

  return finalItems;
}

async function fetchSource(
  source
) {
  if (!source) {
    return [];
  }

  if (
    source.type === 'html'
  ) {
    return fetchHtmlSource(
      source
    );
  }

  if (
    source.type === 'rss' ||
    source.type === 'google-news'
  ) {
    return fetchRssSource(
      source
    );
  }

  console.log(
    `⚠️ نوع منبع ناشناخته: ${source.type}`
  );

  return [];
}

module.exports = {
  fetchAllNews,
  fetchSource,
  fetchRssSource,
  fetchHtmlSource,
  fetchArticle,
  isRecentNews,
  isLocalNews,
  isForeignNews,
  deduplicate,
  normalizeItem
};
