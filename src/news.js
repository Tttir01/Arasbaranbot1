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
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36',
    'Accept':
      'application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
    'Accept-Language':
      'fa-IR,fa;q=0.9,en-US;q=0.7,en;q=0.5'
  }
});

const MAX_NEWS_AGE_HOURS =
  Number(process.env.NEWS_MAX_AGE_HOURS || 48);

const MAX_ITEMS_PER_SOURCE =
  Number(process.env.MAX_ITEMS_PER_SOURCE || 20);

const LOCAL_KEYWORDS = [
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
  'آذربایجان شرقی',
  'آذربايجان شرقي'
];

const FOREIGN_KEYWORDS = [
  'united states',
  'usa',
  'america',
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

/* =========================================================
   HTTP
========================================================= */

function httpGet(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('URL خالی است'));
      return;
    }

    if (redirects > 6) {
      reject(new Error('Redirect بیش از حد مجاز'));
      return;
    }

    const client =
      url.startsWith('https://')
        ? https
        : http;

    const req = client.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36',
          'Accept':
            'application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
          'Accept-Language':
            'fa-IR,fa;q=0.9,en-US;q=0.7,en;q=0.5',
          'Cache-Control': 'no-cache'
        },
        timeout: 30000
      },
      response => {
        const status =
          response.statusCode || 0;

        if (
          status >= 300 &&
          status < 400 &&
          response.headers.location
        ) {
          const nextUrl =
            new URL(
              response.headers.location,
              url
            ).toString();

          response.resume();

          console.log(
            `   ↪ Redirect ${status}: ${nextUrl}`
          );

          httpGet(
            nextUrl,
            redirects + 1
          )
            .then(resolve)
            .catch(reject);

          return;
        }

        let data = '';

        response.setEncoding('utf8');

        response.on(
          'data',
          chunk => {
            data += chunk;
          }
        );

        response.on(
          'end',
          () => {
            console.log(
              `   HTTP ${status} | ${Buffer.byteLength(data, 'utf8')} bytes | ${url}`
            );

            if (
              status < 200 ||
              status >= 300
            ) {
              reject(
                new Error(
                  `HTTP ${status}`
                )
              );
              return;
            }

            resolve(data);
          }
        );
      }
    );

    req.on(
      'timeout',
      () => {
        req.destroy(
          new Error(
            `Timeout: ${url}`
          )
        );
      }
    );

    req.on(
      'error',
      reject
    );
  });
}

/* =========================================================
   DATE
========================================================= */

function parseDate(value) {
  if (!value) return null;

  const d =
    new Date(value);

  if (
    !Number.isNaN(
      d.getTime()
    )
  ) {
    return d;
  }

  return null;
}

/* =========================================================
   IMAGE
========================================================= */

function extractImage(item) {
  try {
    if (
      item.enclosure &&
      item.enclosure.url
    ) {
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
      item.description ||
      '';

    const m =
      html.match(
        /<img[^>]+src=["']([^"']+)["']/i
      );

    return m
      ? m[1]
      : null;
  } catch {
    return null;
  }
}

/* =========================================================
   NORMALIZE
========================================================= */

function normalizeItem(item, source) {
  const title =
    String(
      item.title || ''
    )
      .replace(/\s+/g, ' ')
      .trim();

  const description =
    String(
      item.contentSnippet ||
      item.content ||
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

  return {
    id: crypto
      .createHash('sha1')
      .update(
        `${title}|${link}|${source.name}`
      )
      .digest('hex'),

    title,
    description,
    link,
    image: extractImage(item),

    sourceName:
      source.name || 'منبع نامشخص',

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

/* =========================================================
   LOCAL FILTER
========================================================= */

function containsLocalKeyword(text) {
  const value =
    String(text || '')
      .toLowerCase();

  return LOCAL_KEYWORDS.some(
    keyword =>
      value.includes(
        String(keyword)
          .toLowerCase()
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

/* =========================================================
   FOREIGN FILTER
========================================================= */

function isForeignNews(item) {
  const title =
    String(
      item.title || ''
    ).toLowerCase();

  if (
    containsLocalKeyword(title)
  ) {
    return false;
  }

  return FOREIGN_KEYWORDS.some(
    keyword =>
      title.includes(
        keyword.toLowerCase()
      )
  );
}

/* =========================================================
   RECENT
========================================================= */

function isRecentNews(item) {
  if (!item.publishedAt) {
    return true;
  }

  const date =
    new Date(
      item.publishedAt
    );

  const ageHours =
    (Date.now() -
      date.getTime()) /
    3600000;

  if (
    ageHours < -24
  ) {
    return true;
  }

  return (
    ageHours <=
    MAX_NEWS_AGE_HOURS
  );
}

/* =========================================================
   GOOGLE QUERY
========================================================= */

function buildGoogleQueries(source) {
  const base =
    String(
      source.query ||
      source.search ||
      source.name ||
      ''
    ).trim();

  const result = [];

  function add(q) {
    if (
      q &&
      !result.includes(q)
    ) {
      result.push(q);
    }
  }

  add(base);

  if (/ورزقان/.test(base)) {
    add('ورزقان آذربایجان شرقی');
    add('ورزقان سونگون');
    add('site:tasnimnews.ir ورزقان');
  }

  if (/خاروانا/.test(base)) {
    add('خاروانا ورزقان');
    add('خاروانا آذربایجان شرقی');
  }

  if (/اهر/.test(base)) {
    add('اهر آذربایجان شرقی');
    add('شهرستان اهر');
  }

  if (
    /کلیبر/.test(base) ||
    /كليبر/.test(base)
  ) {
    add('کلیبر آذربایجان شرقی');
    add('شهرستان کلیبر');
  }

  if (/هوراند/.test(base)) {
    add('هوراند آذربایجان شرقی');
    add('شهرستان هوراند');
  }

  if (
    /خداآفرین/.test(base) ||
    /خدا آفرین/.test(base)
  ) {
    add('خداآفرین آذربایجان شرقی');
    add('شهرستان خداآفرین');
  }

  if (/ارسباران/.test(base)) {
    add('ارسباران');
    add('ارسباران آذربایجان شرقی');
  }

  return result.slice(0, 5);
}

function buildGoogleNewsUrl(
  query,
  hl = 'fa',
  gl = 'IR',
  ceid = 'IR:fa'
) {
  return (
    'https://news.google.com/rss/search' +
    `?q=${encodeURIComponent(query)}` +
    `&hl=${encodeURIComponent(hl)}` +
    `&gl=${encodeURIComponent(gl)}` +
    `&ceid=${encodeURIComponent(ceid)}`
  );
}

/* =========================================================
   RSS
========================================================= */

async function fetchRssUrl(
  url,
  source
) {
  console.log(
    `   URL: ${url}`
  );

  try {
    const xml =
      await httpGet(url);

    console.log(
      `   RSS bytes: ${xml.length}`
    );

    const feed =
      await parser.parseString(
        xml
      );

    const items =
      Array.isArray(feed.items)
        ? feed.items
        : [];

    console.log(
      `   RSS items: ${items.length}`
    );

    return items
      .slice(
        0,
        MAX_ITEMS_PER_SOURCE
      )
      .map(
        item =>
          normalizeItem(
            item,
            source
          )
      )
      .filter(
        item =>
          item.title
      );
  } catch (error) {
    console.log(
      `⚠️ RSS error ${source.name}: ${error.message}`
    );

    return [];
  }
}

/* =========================================================
   GOOGLE NEWS
========================================================= */

async function fetchGoogleNewsSource(
  source
) {
  const queries =
    buildGoogleQueries(
      source
    );

  let all = [];

  console.log(
    `🔎 Queryهای ${source.name}: ${queries.length}`
  );

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

    const url =
      buildGoogleNewsUrl(
        query
      );

    let items =
      await fetchRssUrl(
        url,
        source
      );

    if (
      items.length === 0
    ) {
      console.log(
        `   🔁 Google fallback`
      );

      const fallback =
        buildGoogleNewsUrl(
          query,
          'en-US',
          'US',
          'US:en'
        );

      items =
        await fetchRssUrl(
          fallback,
          source
        );
    }

    if (
      items.length > 0
    ) {
      console.log(
        `   ✅ Query موفق: ${query} = ${items.length} خبر`
      );

      all =
        all.concat(items);
    }
  }

  return uniqueItems(
    all
  ).slice(
    0,
    MAX_ITEMS_PER_SOURCE
  );
}

/* =========================================================
   TELEGRAM HTML
========================================================= */

function decodeHtml(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(text) {
  return decodeHtml(
    String(text || '')
      .replace(
        /<br\s*\/?>/gi,
        '\n'
      )
      .replace(
        /<\/p>/gi,
        '\n'
      )
      .replace(
        /<[^>]*>/g,
        ' '
      )
  )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

function fetchTelegramSource(
  source
) {
  return new Promise(
    async resolve => {
      try {
        console.log(
          `📱 Telegram شروع: ${source.name}`
        );

        console.log(
          `   URL: ${source.url}`
        );

        const html =
          await httpGet(
            source.url
          );

        console.log(
          `   Telegram HTML: ${html.length} bytes`
        );

        const items = [];

        /*
         * Telegram public preview:
         * هر پیام معمولاً در div.tgme_widget_message قرار دارد.
         */

        const messageRegex =
          /<div[^>]+class="[^"]*tgme_widget_message_wrap[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi;

        const blocks =
          html.match(
            messageRegex
          ) || [];

        for (
          const block of blocks
        ) {
          let title = '';
          let description = '';

          const textMatch =
            block.match(
              /<div[^>]+class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i
            );

          if (textMatch) {
            description =
              stripHtml(
                textMatch[1]
              );
          }

          /*
           * اگر متن پیام پیدا شد،
           * چند کلمه اول را عنوان قرار می‌دهیم.
           */
          if (description) {
            title =
              description.length > 120
                ? description.substring(
                    0,
                    120
                  ) + '...'
                : description;
          }

          /*
           * لینک پیام
           */
          const linkMatch =
            block.match(
              /href="(https:\/\/t\.me\/[^"]+)"[^>]*class="[^"]*tgme_widget_message_date/i
            );

          const link =
            linkMatch
              ? linkMatch[1]
              : source.url;

          /*
           * تاریخ
           */
          const dateMatch =
            block.match(
              /datetime="([^"]+)"/i
            );

          const date =
            dateMatch
              ? parseDate(
                  dateMatch[1]
                )
              : null;

          /*
           * تصویر
           */
          const imageMatch =
            block.match(
              /background-image:url\(['"]?([^'")]+)['"]?\)/i
            );

          const image =
            imageMatch
              ? imageMatch[1]
              : null;

          if (
            title &&
            description
          ) {
            items.push({
              title,
              description,
              link,
              image,
              publishedAt:
                date
                  ? date.toISOString()
                  : null,
              sourceName:
                source.name
            });
          }

          if (
            items.length >=
            MAX_ITEMS_PER_SOURCE
          ) {
            break;
          }
        }

        /*
         * اگر ساختار جدید Telegram
         * با Regex بالا پیدا نشد،
         * از meta description نیز استفاده می‌کنیم.
         */
        if (
          items.length === 0
        ) {
          const metaMatches =
            html.matchAll(
              /<meta[^>]+property="og:description"[^>]+content="([^"]+)"/gi
            );

          for (
            const match of metaMatches
          ) {
            const text =
              stripHtml(
                match[1]
              );

            if (
              text &&
              containsLocalKeyword(
                text
              )
            ) {
              items.push({
                title:
                  text.length > 120
                    ? text.substring(
                        0,
                        120
                      ) + '...'
                    : text,

                description: text,

                link:
                  source.url,

                image: null,

                publishedAt: null,

                sourceName:
                  source.name
              });
            }
          }
        }

        console.log(
          `   📱 Telegram items: ${items.length}`
        );

        resolve(
          items.map(
            item =>
              normalizeItem(
                item,
                source
              )
          )
        );
      } catch (error) {
        console.log(
          `⚠️ Telegram error ${source.name}: ${error.message}`
        );

        resolve([]);
      }
    }
  );
}

/* =========================================================
   SOURCE
========================================================= */

async function fetchSource(
  source
) {
  const type =
    String(
      source.type || 'rss'
    )
      .toLowerCase()
      .trim();

  if (
    type === 'google-news' ||
    type === 'google_news' ||
    type === 'googlenews'
  ) {
    return fetchGoogleNewsSource(
      source
    );
  }

  if (
    type === 'telegram'
  ) {
    return fetchTelegramSource(
      source
    );
  }

  if (
    type === 'rss'
  ) {
    return fetchRssUrl(
      source.url,
      source
    );
  }

  console.log(
    `⚠️ نوع منبع ناشناخته: ${type}`
  );

  return [];
}

/* =========================================================
   UNIQUE
========================================================= */

function uniqueItems(
  items
) {
  const map =
    new Map();

  for (
    const item of items
  ) {
    const key =
      item.link ||
      `${item.title}|${item.sourceName}`;

    if (
      !map.has(key)
    ) {
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
   ALL NEWS
========================================================= */

async function fetchAllNews() {
  console.log(
    '================================'
  );

  console.log(
    'ARASBARAN NEWS BOT'
  );

  console.log(
    'در حال دریافت اخبار...'
  );

  console.log(
    '================================'
  );

  const sources =
    await loadSources();

  const active =
    Array.isArray(sources)
      ? sources.filter(
          s =>
            s &&
            s.enabled !== false
        )
      : [];

  console.log(
    `تعداد منابع فعال: ${active.length}`
  );

  console.log(
    `حداکثر سن خبر: ${MAX_NEWS_AGE_HOURS} ساعت`
  );

  console.log(
    '================================'
  );

  let raw = [];

  let successful = 0;
  let empty = 0;

  for (
    const source of active
  ) {
    console.log(
      `در حال دریافت: ${source.name}`
    );

    try {
      const items =
        await fetchSource(
          source
        );

      console.log(
        `   نتیجه ${source.name}: ${items.length}`
      );

      if (
        items.length
      ) {
        successful++;

        raw =
          raw.concat(
            items
          );
      } else {
        empty++;
      }
    } catch (error) {
      empty++;

      console.log(
        `❌ خطا: ${source.name}: ${error.message}`
      );
    }
  }

  console.log(
    '================================'
  );

  console.log(
    `منابع موفق: ${successful}`
  );

  console.log(
    `منابع خالی/ناموفق: ${empty}`
  );

  console.log(
    `کل اخبار خام: ${raw.length}`
  );

  const before =
    raw.length;

  raw =
    uniqueItems(
      raw
    );

  console.log(
    `بعد از حذف تکراری: ${raw.length}`
  );

  console.log(
    `تعداد تکراری حذف‌شده: ${
      before - raw.length
    }`
  );

  const recent =
    raw.filter(
      isRecentNews
    );

  console.log(
    `بعد از فیلتر ${MAX_NEWS_AGE_HOURS} ساعت: ${recent.length}`
  );

  const local =
    recent.filter(
      isLocalNews
    );

  console.log(
    `بعد از فیلتر محلی: ${local.length}`
  );

  const final =
    local.filter(
      item =>
        !isForeignNews(item)
    );

  console.log(
    `بعد از حذف اخبار خارجی: ${final.length}`
  );

  final.sort(
    (a, b) => {
      const ta =
        a.publishedAt
          ? new Date(
              a.publishedAt
            ).getTime()
          : 0;

      const tb =
        b.publishedAt
          ? new Date(
              b.publishedAt
            ).getTime()
          : 0;

      return tb - ta;
    }
  );

  console.log(
    `تعداد اخبار دریافت‌شده: ${final.length}`
  );

  if (
    final.length
  ) {
    console.log(
      '================================'
    );

    console.log(
      'اخبار نهایی:'
    );

    final
      .slice(0, 30)
      .forEach(
        (item, i) => {
          console.log(
            `${i + 1}. ${item.title}`
          );

          console.log(
            `   منبع: ${item.sourceName}`
          );

          console.log(
            `   تاریخ: ${
              item.publishedAt ||
              'بدون تاریخ'
            }`
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

  return final;
}

/* =========================================================
   EXPORT
========================================================= */

module.exports = {
  fetchAllNews,
  fetchSource,
  fetchGoogleNewsSource,
  fetchTelegramSource,
  isRecentNews,
  isLocalNews,
  isForeignNews,
  uniqueItems,
  buildGoogleQueries,
  buildGoogleNewsUrl,
  normalizeItem,
  extractImage
};
