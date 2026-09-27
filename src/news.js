'use strict';

const Parser = require('rss-parser');
const https = require('https');
const http = require('http');
const cheerio = require('cheerio');

const {
  loadSources
} = require('./sources');

const parser = new Parser({
  timeout: 30000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  }
});

const AREAS = [
  'ورزقان',
  'خاروانا',
  'اهر',
  'کلیبر',
  'هوراند',
  'خداآفرین',
  'ارسباران'
];

const LOCAL_KEYWORDS = [
  'ورزقان',
  'خاروانا',
  'اهر',
  'کلیبر',
  'هوراند',
  'خداآفرین',
  'ارسباران',
  'سونگون',
  'خمارلو',
  'قره‌داغ',
  'قره داغ',
  'آذربایجان شرقی',
  'آذربایجان‌شرقی',
  'جنگل ارسباران',
  'منطقه ارسباران',
  'ارس'
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
  'european',
  'غزه',
  'اسرائیل',
  'اوکراین',
  'افغانستان',
  'پاکستان'
];

const IRRELEVANT_KEYWORDS = [
  'هالیوود',
  'بازیگر خارجی',
  'خواننده خارجی',
  'سلبریتی خارجی'
];

function normalizeText(value) {
  if (!value) return '';

  return String(value)
    .replace(/ي/g, 'ی')
    .replace(/ى/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ۀ/g, 'ه')
    .replace(/ة/g, 'ه')
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

function decodeHtml(value) {
  return cleanHtml(value);
}

function absoluteUrl(base, url) {
  if (!url) return '';

  try {
    return new URL(url, base).href;
  } catch (error) {
    return '';
  }
}

function requestUrl(url) {
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
        },
        timeout: 30000
      },
      response => {
        let data = '';

        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          requestUrl(
            absoluteUrl(
              url,
              response.headers.location
            )
          )
            .then(resolve)
            .catch(reject);

          return;
        }

        response.setEncoding('utf8');

        response.on('data', chunk => {
          data += chunk;
        });

        response.on('end', () => {
          if (
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            reject(
              new Error(
                `HTTP ${response.statusCode} برای ${url}`
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

function parseDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (!Number.isNaN(date.getTime())) {
    return date;
  }

  return null;
}

function findDate($, selector) {
  const candidates = [];

  $(selector).each((index, element) => {
    const el = $(element);

    const values = [
      el.attr('datetime'),
      el.attr('content'),
      el.attr('value'),
      el.text()
    ];

    for (const value of values) {
      if (value) {
        candidates.push(
          String(value).trim()
        );
      }
    }
  });

  for (const value of candidates) {
    const date = parseDate(value);

    if (date) return date;
  }

  return null;
}

function extractArticleDate($) {
  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[property="article:modified_time"]',
    'meta[name="date"]',
    'meta[name="pubdate"]',
    'meta[itemprop="datePublished"]',
    'time[datetime]'
  ];

  for (const selector of metaSelectors) {
    const date = findDate($, selector);

    if (date) return date;
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
    const value = $(selector).attr('content');

    if (value) {
      return absoluteUrl(baseUrl, value);
    }
  }

  const image =
    $('article img').first().attr('src') ||
    $('.post img').first().attr('src') ||
    $('main img').first().attr('src');

  return absoluteUrl(baseUrl, image);
}

function extractDescription($) {
  const meta =
    $('meta[name="description"]').attr('content');

  if (meta) {
    return decodeHtml(meta);
  }

  const og =
    $('meta[property="og:description"]')
      .attr('content');

  if (og) {
    return decodeHtml(og);
  }

  const text =
    $('article').first().text() ||
    $('.post').first().text() ||
    $('main').first().text();

  return decodeHtml(text).substring(0, 1000);
}

function isLocalNews(item) {
  const text = normalizeText(
    `${item.title || ''} ${item.description || ''} ${
      item.sourceName || ''
    }`
  ).toLowerCase();

  return LOCAL_KEYWORDS.some(keyword =>
    text.includes(
      normalizeText(keyword).toLowerCase()
    )
  );
}

function isForeignNews(item) {
  const text = normalizeText(
    `${item.title || ''} ${item.description || ''}`
  ).toLowerCase();

  return FOREIGN_KEYWORDS.some(keyword =>
    text.includes(
      normalizeText(keyword).toLowerCase()
    )
  );
}

function isIrrelevantNews(item) {
  const text = normalizeText(
    `${item.title || ''} ${item.description || ''}`
  ).toLowerCase();

  return IRRELEVANT_KEYWORDS.some(keyword =>
    text.includes(
      normalizeText(keyword).toLowerCase()
    )
  );
}

function isRecentNews(item, hours = 48) {
  if (!item.publishedAt) {
    return false;
  }

  const published =
    new Date(item.publishedAt).getTime();

  if (Number.isNaN(published)) {
    return false;
  }

  const now = Date.now();

  const age =
    (now - published) /
    (1000 * 60 * 60);

  if (age < -3) {
    return false;
  }

  return age <= hours;
}

function normalizeItem(item, source) {
  const title = decodeHtml(
    item.title ||
      item.name ||
      'خبر جدید'
  );

  const description = decodeHtml(
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

  const videoUrl =
    item.videoUrl ||
    '';

  const sourceName =
    item.sourceName ||
    source.name ||
    '';

  const id =
    item.id ||
    item.guid ||
    link ||
    `${source.id}:${title}`;

  return {
    id: String(id),
    sourceId: source.id,
    sourceName,
    title: title.trim(),
    description: description.trim(),
    link,
    publishedAt,
    imageUrl,
    videoUrl,
    areas: Array.isArray(source.areas)
      ? source.areas
      : []
  };
}

async function fetchRssSource(source) {
  console.log(
    `RSS دریافت: ${source.name}`
  );

  try {
    const feed =
      await parser.parseURL(source.url);

    const items =
      Array.isArray(feed.items)
        ? feed.items
        : [];

    console.log(
      `RSS ${source.name}: ${items.length} آیتم`
    );

    return items.map(item =>
      normalizeItem(
        {
          id:
            item.guid ||
            item.id ||
            item.link,
          title: item.title,
          description:
            item.contentSnippet ||
            item.content ||
            item.summary,
          link: item.link,
          publishedAt:
            item.isoDate ||
            item.pubDate,
          imageUrl:
            item.enclosure &&
            item.enclosure.url,
          sourceName: source.name
        },
        source
      )
    );
  } catch (error) {
    console.error(
      `❌ RSS ${source.name}:`,
      error.message
    );

    return [];
  }
}

async function fetchHtmlSource(source) {
  console.log(
    `HTML دریافت: ${source.name}`
  );

  try {
    const html =
      await requestUrl(source.url);

    const $ = cheerio.load(html);

    const links = [];

    $('a[href]').each(
      (index, element) => {
        const href =
          $(element).attr('href');

        const title =
          $(element).text().trim();

        if (!href || !title) return;

        const fullUrl =
          absoluteUrl(
            source.url,
            href
          );

        if (!fullUrl) return;

        if (
          fullUrl === source.url ||
          fullUrl ===
            `${source.url}/`
        ) {
          return;
        }

        if (
          !/^https?:\/\//i.test(fullUrl)
        ) {
          return;
        }

        if (
          links.some(
            item =>
              item.url === fullUrl
          )
        ) {
          return;
        }

        links.push({
          url: fullUrl,
          title
        });
      }
    );

    const candidates =
      links.filter(item => {
        const text =
          normalizeText(
            item.title
          );

        return (
          text.length >= 12 &&
          text.length <= 250
        );
      });

    const limited =
      candidates.slice(
        0,
        Number(
          source.maxItems || 20
        )
      );

    const results = [];

    for (const candidate of limited) {
      try {
        const article =
          await fetchArticle(
            candidate.url,
            source
          );

        if (!article) continue;

        if (
          !article.title ||
          !article.link
        ) {
          continue;
        }

        results.push(article);
      } catch (error) {
        console.error(
          `⚠️ خطا در مقاله ${candidate.url}:`,
          error.message
        );
      }
    }

    console.log(
      `HTML ${source.name}: ${results.length} آیتم`
    );

    return results;
  } catch (error) {
    console.error(
      `❌ HTML ${source.name}:`,
      error.message
    );

    return [];
  }
}

async function fetchArticle(
  url,
  source
) {
  const html =
    await requestUrl(url);

  const $ = cheerio.load(html);

  let title =
    $('meta[property="og:title"]')
      .attr('content') ||
    $('h1').first().text() ||
    $('title').text();

  title = decodeHtml(title);

  if (!title) return null;

  const description =
    extractDescription($);

  const publishedAt =
    extractArticleDate($);

  const imageUrl =
    extractImage($, url);

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
        publishedAt
          ? publishedAt.toISOString()
          : null,
      imageUrl,
      sourceName: source.name
    },
    source
  );
}

async function fetchSource(source) {
  if (!source || source.enabled === false) {
    return [];
  }

  if (source.type === 'html') {
    return fetchHtmlSource(source);
  }

  if (
    source.type === 'rss' ||
    source.type === 'google-news'
  ) {
    return fetchRssSource(source);
  }

  console.log(
    `⚠️ نوع منبع ناشناخته: ${source.type}`
  );

  return [];
}

function deduplicate(items) {
  const map = new Map();

  for (const item of items) {
    const key =
      item.link ||
      item.id ||
      `${item.title}:${item.publishedAt}`;

    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return Array.from(map.values());
}

async function fetchAllNews() {
  const sources =
    loadSources();

  let rawItems = [];

  console.log(
    `تعداد منابع فعال: ${sources.length}`
  );

  for (const source of sources) {
    console.log(
      `در حال دریافت: ${source.name}`
    );

    const items =
      await fetchSource(source);

    rawItems =
      rawItems.concat(items);
  }

  console.log(
    `کل اخبار خام: ${rawItems.length}`
  );

  const unique =
    deduplicate(rawItems);

  console.log(
    `بعد از حذف تکراری: ${unique.length}`
  );

  const recent =
    unique.filter(item => {
      const ok =
        isRecentNews(item, 48);

      if (!ok) {
        if (item.publishedAt) {
          const age =
            (
              Date.now() -
              new Date(
                item.publishedAt
              ).getTime()
            ) /
            (1000 * 60 * 60);

          console.log(
            `⏰ خبر قدیمی (${Math.round(
              age
            )} ساعت): ${item.title}`
          );
        }

        return false;
      }

      return true;
    });

  console.log(
    `بعد از فیلتر 48 ساعت: ${recent.length}`
  );

  const local =
    recent.filter(item =>
      isLocalNews(item)
    );

  console.log(
    `بعد از فیلتر محلی: ${local.length}`
  );

  const nonForeign =
    local.filter(item =>
      !isForeignNews(item)
    );

  console.log(
    `بعد از حذف منابع خارجی: ${nonForeign.length}`
  );

  const relevant =
    nonForeign.filter(item =>
      !isIrrelevantNews(item)
    );

  console.log(
    `بعد از حذف اخبار نامرتبط: ${relevant.length}`
  );

  relevant.sort(
    (a, b) =>
      new Date(b.publishedAt || 0) -
      new Date(a.publishedAt || 0)
  );

  const max =
    Number(
      process.env.MAX_TOTAL_ITEMS || 30
    );

  return relevant.slice(0, max);
}

module.exports = {
  fetchAllNews,
  fetchSource,
  fetchRssSource,
  fetchHtmlSource,
  isRecentNews,
  isLocalNews,
  isForeignNews,
  isIrrelevantNews,
  deduplicate,
  normalizeItem
};
