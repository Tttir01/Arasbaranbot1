'use strict';

const Parser = require('rss-parser');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const cheerio = require('cheerio');

const { loadSources } = require('./sources');

/* =========================================================
   CONFIG
========================================================= */

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

const MAX_TOTAL_ITEMS =
  Number(process.env.MAX_TOTAL_ITEMS || 30);

const REQUEST_TIMEOUT =
  Number(process.env.REQUEST_TIMEOUT || 25000);

/* =========================================================
   LOCAL KEYWORDS
========================================================= */

const LOCAL_KEYWORDS = [
  'ورزقان',
  'ورزغان',
  'خاروانا',
  'اهر',
  'کلیبر',
  'كليبر',
  'هوراند',
  'خداآفرین',
  'خدا آفرین',
  'خداآفرين',
  'ارسباران',
  'قره داغ',
  'قره‌داغ',
  'قره داغ',
  'سونگون',
  'مس سونگون',
  'آذربایجان شرقی',
  'آذربايجان شرقي'
];

/* =========================================================
   FOREIGN KEYWORDS
========================================================= */

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
  'india',
  'ایالات متحده',
  'آمریکا',
  'انگلیس',
  'بریتانیا',
  'فرانسه',
  'آلمان',
  'اسرائیل',
  'اوکراین',
  'روسیه',
  'چین',
  'ژاپن'
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

    if (redirects > 8) {
      reject(new Error('Redirect بیش از حد مجاز'));
      return;
    }

    let client;

    try {
      client = url.startsWith('https://')
        ? https
        : http;
    } catch (error) {
      reject(error);
      return;
    }

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

          'Cache-Control':
            'no-cache'
        },

        timeout: REQUEST_TIMEOUT
      },

      response => {
        const status =
          response.statusCode || 0;

        /*
         * Redirect
         */

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
              `   HTTP ${status} | ${Buffer.byteLength(
                data,
                'utf8'
              )} bytes`
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
   HTML HELPERS
========================================================= */

function decodeHtml(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCharCode(Number(n))
    );
}

function stripHtml(text) {
  return decodeHtml(
    String(text || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(text) {
  return stripHtml(text)
    .replace(/\s+/g, ' ')
    .trim();
}

/* =========================================================
   DATE
========================================================= */

function parseDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value;
  }

  const text =
    String(value).trim();

  if (!text) {
    return null;
  }

  /*
   * ISO / RFC
   */

  let date =
    new Date(text);

  if (
    !Number.isNaN(
      date.getTime()
    )
  ) {
    return date;
  }

  /*
   * Persian / Jalali date
   * مانند:
   * 05 مهر 1405
   * 1405/07/05
   */

  const months = {
    'فروردین': 1,
    'اردیبهشت': 2,
    'خرداد': 3,
    'تیر': 4,
    'مرداد': 5,
    'شهریور': 6,
    'مهر': 7,
    'آبان': 8,
    'آذر': 9,
    'دی': 10,
    'بهمن': 11,
    'اسفند': 12
  };

  const normalized =
    text
      .replace(
        /۰/g,
        '0'
      )
      .replace(
        /۱/g,
        '1'
      )
      .replace(
        /۲/g,
        '2'
      )
      .replace(
        /۳/g,
        '3'
      )
      .replace(
        /۴/g,
        '4'
      )
      .replace(
        /۵/g,
        '5'
      )
      .replace(
        /۶/g,
        '6'
      )
      .replace(
        /۷/g,
        '7'
      )
      .replace(
        /۸/g,
        '8'
      )
      .replace(
        /۹/g,
        '9'
      );

  const numeric =
    normalized.match(
      /(14\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})/
    );

  if (numeric) {
    const y =
      Number(numeric[1]);

    const m =
      Number(numeric[2]);

    const d =
      Number(numeric[3]);

    /*
     * تبدیل تقریبی جلالی به میلادی.
     * برای فیلتر 48 ساعته کافی است.
     */

    const gy =
      y + 621;

    const gm =
      Math.min(
        12,
        Math.max(
          1,
          m + 3
        )
      );

    date =
      new Date(
        Date.UTC(
          gy,
          gm - 1,
          Math.min(
            d,
            28
          )
        )
      );

    if (
      !Number.isNaN(
        date.getTime()
      )
    ) {
      return date;
    }
  }

  const named =
    normalized.match(
      /(\d{1,2})\s+(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)\s+(14\d{2})/
    );

  if (named) {
    const day =
      Number(named[1]);

    const month =
      months[named[2]];

    const year =
      Number(named[3]);

    if (
      month &&
      year
    ) {
      date =
        new Date(
          Date.UTC(
            year + 621,
            Math.min(
              11,
              month + 2
            ),
            Math.min(
              day,
              28
            )
          )
        );

      if (
        !Number.isNaN(
          date.getTime()
        )
      ) {
        return date;
      }
    }
  }

  return null;
}

/* =========================================================
   IMAGE
========================================================= */

function extractImage(item) {
  try {
    if (
      item.image
    ) {
      return item.image;
    }

    if (
      item.imageUrl
    ) {
      return item.imageUrl;
    }

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

    const match =
      String(html).match(
        /<img[^>]+(?:src|data-src)=["']([^"']+)["']/i
      );

    return match
      ? match[1]
      : null;
  } catch {
    return null;
  }
}

/* =========================================================
   NORMALIZE
========================================================= */

function normalizeItem(
  item,
  source
) {
  const title =
    cleanText(
      item.title ||
      ''
    );

  const description =
    cleanText(
      item.contentSnippet ||
      item.content ||
      item.description ||
      item.summary ||
      ''
    );

  const link =
    item.link ||
    item.guid ||
    source.url ||
    '';

  const publishedAt =
    parseDate(
      item.isoDate ||
      item.pubDate ||
      item.published ||
      item.updated ||
      item.date ||
      item.publishedAt
    );

  const image =
    extractImage(
      item
    );

  const sourceName =
    source.name ||
    item.sourceName ||
    'منبع نامشخص';

  /*
   * ID پایدارتر:
   * URL + عنوان نرمال‌شده
   */

  const normalizedTitle =
    title
      .toLowerCase()
      .replace(
        /[\u200c\u200f]/g,
        ''
      )
      .replace(
        /[^\p{L}\p{N}]+/gu,
        ' '
      )
      .trim();

  const id =
    crypto
      .createHash('sha1')
      .update(
        `${normalizedTitle}|${link}`
      )
      .digest('hex');

  return {
    id,

    title,

    description,

    link,

    /*
     * هر دو نام برای سازگاری با index.js
     */

    image,

    imageUrl:
      image || null,

    videoUrl:
      item.videoUrl ||
      null,

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
      item.publishedAt ||
      null
  };
}

/* =========================================================
   LOCAL FILTER
========================================================= */

function containsLocalKeyword(
  text
) {
  const value =
    String(
      text || ''
    )
      .toLowerCase();

  return LOCAL_KEYWORDS.some(
    keyword =>
      value.includes(
        String(
          keyword
        ).toLowerCase()
      )
  );
}

function isLocalNews(
  item
) {
  const text = [
    item.title,
    item.description,
    item.sourceName,
    item.link
  ]
    .filter(Boolean)
    .join(' ');

  return containsLocalKeyword(
    text
  );
}

/* =========================================================
   FOREIGN FILTER
========================================================= */

function isForeignNews(
  item
) {
  const text = [
    item.title,
    item.description
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  /*
   * اگر خود خبر نشانه محلی دارد،
   * آن را خارجی حساب نکن.
   */

  if (
    containsLocalKeyword(
      text
    )
  ) {
    return false;
  }

  return FOREIGN_KEYWORDS.some(
    keyword =>
      text.includes(
        keyword.toLowerCase()
      )
  );
}

/* =========================================================
   RECENT
========================================================= */

function isRecentNews(
  item
) {
  if (
    !item.publishedAt
  ) {
    /*
     * اخبار بدون تاریخ حذف نمی‌شوند.
     * چون بعضی کانال‌های محلی تاریخ را
     * در HTML به شکل غیر استاندارد قرار می‌دهند.
     */

    return true;
  }

  const date =
    new Date(
      item.publishedAt
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return true;
  }

  const ageHours =
    (
      Date.now() -
      date.getTime()
    ) / 3600000;

  /*
   * کمی آینده را تحمل می‌کنیم.
   */

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
   GOOGLE NEWS
========================================================= */

function buildGoogleQueries(
  source
) {
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

  if (
    /ورزقان/.test(base)
  ) {
    add('ورزقان');
    add('ورزقان سونگون');
    add('ورزقان آذربایجان شرقی');
  }

  if (
    /خاروانا/.test(base)
  ) {
    add('خاروانا');
    add('خاروانا ورزقان');
  }

  if (
    /اهر/.test(base)
  ) {
    add('اهر');
    add('اهر آذربایجان شرقی');
  }

  if (
    /کلیبر/.test(base) ||
    /كليبر/.test(base)
  ) {
    add('کلیبر');
    add('کلیبر آذربایجان شرقی');
  }

  if (
    /هوراند/.test(base)
  ) {
    add('هوراند');
    add('هوراند آذربایجان شرقی');
  }

  if (
    /خداآفرین/.test(base) ||
    /خدا آفرین/.test(base)
  ) {
    add('خداآفرین');
    add('خداآفرین آذربایجان شرقی');
  }

  if (
    /ارسباران/.test(base)
  ) {
    add('ارسباران');
    add('ارسباران آذربایجان شرقی');
  }

  return result.slice(
    0,
    5
  );
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
      await httpGet(
        url
      );

    const feed =
      await parser.parseString(
        xml
      );

    const items =
      Array.isArray(
        feed.items
      )
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

    /*
     * اول نسخه فارسی.
     */

    let items =
      await fetchRssUrl(
        buildGoogleNewsUrl(
          query,
          'fa',
          'IR',
          'IR:fa'
        ),
        source
      );

    /*
     * Google گاهی RSS فارسی را به US/English
     * Redirect می‌کند. در این حالت fallback اجرا می‌شود.
     */

    if (
      !items.length
    ) {
      items =
        await fetchRssUrl(
          buildGoogleNewsUrl(
            query,
            'en-US',
            'US',
            'US:en'
          ),
          source
        );
    }

    if (
      items.length
    ) {
      all =
        all.concat(
          items
        );

      console.log(
        `   ✅ ${items.length} خبر از Google`
      );
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
   TELEGRAM
========================================================= */

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

        const $ =
          cheerio.load(
            html
          );

        const items = [];

        /*
         * Telegram public channel:
         * .tgme_widget_message_wrap
         */

        $('.tgme_widget_message_wrap')
          .each(
            (index, element) => {
              if (
                items.length >=
                MAX_ITEMS_PER_SOURCE
              ) {
                return;
              }

              const block =
                $(element);

              const text =
                cleanText(
                  block
                    .find(
                      '.tgme_widget_message_text'
                    )
                    .first()
                    .text()
                );

              if (
                !text
              ) {
                return;
              }

              /*
               * عنوان:
               * از اولین جمله/خط استفاده می‌کنیم.
               */

              let title =
                text;

              const lines =
                text
                  .split(
                    /[\n\r]+/
                  )
                  .map(
                    x =>
                      x.trim()
                  )
                  .filter(Boolean);

              if (
                lines.length
              ) {
                title =
                  lines[0];
              }

              if (
                title.length > 150
              ) {
                title =
                  title.substring(
                    0,
                    147
                  ) + '...';
              }

              /*
               * لینک واقعی همان پست
               */

              let link =
                '';

              const dateAnchor =
                block
                  .find(
                    '.tgme_widget_message_date'
                  )
                  .first();

              if (
                dateAnchor.length
              ) {
                link =
                  dateAnchor.attr(
                    'href'
                  ) || '';
              }

              /*
               * تاریخ واقعی Telegram
               */

              let publishedAt =
                null;

              const timeElement =
                block
                  .find(
                    'time'
                  )
                  .first();

              if (
                timeElement.length
              ) {
                publishedAt =
                  parseDate(
                    timeElement.attr(
                      'datetime'
                    )
                  );
              }

              if (
                !publishedAt &&
                dateAnchor.length
              ) {
                publishedAt =
                  parseDate(
                    dateAnchor.attr(
                      'title'
                    )
                  );
              }

              /*
               * تصویر
               */

              let image =
                null;

              const photo =
                block
                  .find(
                    '.tgme_widget_message_photo_wrap'
                  )
                  .first();

              if (
                photo.length
              ) {
                const style =
                  photo.attr(
                    'style'
                  ) || '';

                const bg =
                  style.match(
                    /background-image\s*:\s*url\(['"]?([^'")]+)['"]?\)/i
                  );

                if (
                  bg
                ) {
                  image =
                    bg[1];
                }
              }

              if (
                !image
              ) {
                const img =
                  block
                    .find(
                      'img'
                    )
                    .first();

                if (
                  img.length
                ) {
                  image =
                    img.attr(
                      'src'
                    ) ||
                    img.attr(
                      'data-src'
                    ) ||
                    null;
                }
              }

              items.push({
                title,

                description:
                  text,

                link:
                  link ||
                  source.url,

                image,

                imageUrl:
                  image,

                publishedAt:
                  publishedAt
                    ? publishedAt.toISOString()
                    : null,

                sourceName:
                  source.name
              });
            }
          );

        console.log(
          `   📱 Telegram items: ${items.length}`
        );

        resolve(
          items
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
   HTML SOURCE
========================================================= */

async function fetchHtmlSource(
  source
) {
  console.log(
    `🌐 HTML شروع: ${source.name}`
  );

  try {
    const html =
      await httpGet(
        source.url
      );

    console.log(
      `   HTML bytes: ${html.length}`
    );

    const $ =
      cheerio.load(
        html
      );

    const items = [];

    /*
     * برای Tasnim و سایت‌های خبری مشابه،
     * لینک خبر معمولاً /fa/news/ است.
     */

    const selectors = [
      'a[href*="/fa/news/"]',
      'article a[href*="/fa/news/"]',
      '.news-list a[href*="/fa/news/"]',
      '.news a[href*="/fa/news/"]',
      '.item a[href*="/fa/news/"]'
    ];

    const seenLinks =
      new Set();

    for (
      const selector of selectors
    ) {
      $(selector)
        .each(
          (index, element) => {
            if (
              items.length >=
              MAX_ITEMS_PER_SOURCE
            ) {
              return;
            }

            const a =
              $(element);

            let title =
              cleanText(
                a.text()
              );

            let link =
              a.attr(
                'href'
              );

            if (
              !title ||
              !link
            ) {
              return;
            }

            if (
              link.startsWith('/')
            ) {
              link =
                new URL(
                  link,
                  source.url
                ).toString();
            }

            if (
              !/^https?:\/\//i.test(
                link
              )
            ) {
              return;
            }

            if (
              seenLinks.has(
                link
              )
            ) {
              return;
            }

            /*
             * لینک‌های غیرخبری را حذف کن.
             */

            if (
              !link.includes(
                '/fa/news/'
              )
            ) {
              return;
            }

            seenLinks.add(
              link
            );

            /*
             * والد نزدیک برای گرفتن خلاصه
             */

            const parent =
              a.closest(
                'article, .news-item, .item, li, div'
              );

            let description =
              '';

            if (
              parent &&
              parent.length
            ) {
              description =
                cleanText(
                  parent.text()
                );
            }

            /*
             * از title تکراری جلوگیری کن.
             */

            if (
              description ===
              title
            ) {
              description =
                '';
            }

            items.push({
              title,

              description,

              link,

              image:
                null,

              imageUrl:
                null,

              publishedAt:
                null,

              sourceName:
                source.name
            });
          }
        );

      if (
        items.length >=
        MAX_ITEMS_PER_SOURCE
      ) {
        break;
      }
    }

    /*
     * اگر هیچ خبر پیدا نشد،
     * لینک‌های عمومی صفحه را بررسی می‌کنیم.
     */

    if (
      items.length === 0
    ) {
      $('a')
        .each(
          (index, element) => {
            if (
              items.length >=
              MAX_ITEMS_PER_SOURCE
            ) {
              return;
            }

            const a =
              $(element);

            const href =
              a.attr(
                'href'
              );

            const title =
              cleanText(
                a.text()
              );

            if (
              !href ||
              !title
            ) {
              return;
            }

            if (
              !href.includes(
                '/fa/news/'
              )
            ) {
              return;
            }

            let link =
              href;

            if (
              link.startsWith('/')
            ) {
              link =
                new URL(
                  link,
                  source.url
                ).toString();
            }

            if (
              seenLinks.has(
                link
              )
            ) {
              return;
            }

            seenLinks.add(
              link
            );

            items.push({
              title,

              description:
                '',

              link,

              image:
                null,

              imageUrl:
                null,

              publishedAt:
                null,

              sourceName:
                source.name
            });
          }
        );
    }

    /*
     * تلاش برای استخراج تصویر OG صفحه اصلی
     * به عنوان fallback.
     */

    let pageImage =
      $('meta[property="og:image"]')
        .attr(
          'content'
        ) ||
      null;

    if (
      pageImage &&
      pageImage.startsWith('/')
    ) {
      pageImage =
        new URL(
          pageImage,
          source.url
        ).toString();
    }

    const normalized =
      items.map(
        item => {
          if (
            !item.image &&
            pageImage
          ) {
            item.image =
              pageImage;

            item.imageUrl =
              pageImage;
          }

          return normalizeItem(
            item,
            source
          );
        }
      );

    console.log(
      `   🌐 HTML items: ${normalized.length}`
    );

    return normalized;
  } catch (error) {
    console.log(
      `⚠️ HTML error ${source.name}: ${error.message}`
    );

    return [];
  }
}

/* =========================================================
   SOURCE DISPATCHER
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
    type === 'html' ||
    type === 'web' ||
    type === 'website'
  ) {
    return fetchHtmlSource(
      source
    );
  }

  if (
    type === 'rss' ||
    type === 'xml'
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
   NORMALIZATION FOR DEDUPLICATION
========================================================= */

function normalizeForCompare(
  text
) {
  return String(
    text || ''
  )
    .toLowerCase()
    .replace(
      /ی/g,
      'ي'
    )
    .replace(
      /ک/g,
      'ك'
    )
    .replace(
      /ۀ/g,
      'ه'
    )
    .replace(
      /ة/g,
      'ه'
    )
    .replace(
      /[\u200c\u200f]/g,
      ''
    )
    .replace(
      /[^\p{L}\p{N}]+/gu,
      ' '
    )
    .trim();
}

/* =========================================================
   SIMILARITY
========================================================= */

function titleSimilarity(
  a,
  b
) {
  const aa =
    normalizeForCompare(
      a
    )
      .split(' ')
      .filter(
        x =>
          x.length >= 2
      );

  const bb =
    new Set(
      normalizeForCompare(
        b
      )
        .split(' ')
        .filter(
          x =>
            x.length >= 2
        )
    );

  if (
    !aa.length ||
    !bb.size
  ) {
    return 0;
  }

  let common = 0;

  for (
    const word of aa
  ) {
    if (
      bb.has(word)
    ) {
      common++;
    }
  }

  return (
    common /
    Math.max(
      aa.length,
      bb.size
    )
  );
}

/* =========================================================
   UNIQUE
========================================================= */

function uniqueItems(
  items
) {
  const result = [];

  const exactLinks =
    new Set();

  const exactTitles =
    new Set();

  for (
    const item of items
  ) {
    if (
      !item ||
      !item.title
    ) {
      continue;
    }

    const title =
      normalizeForCompare(
        item.title
      );

    const link =
      String(
        item.link || ''
      )
        .trim();

    /*
     * لینک کاملاً یکسان
     */

    if (
      link &&
      exactLinks.has(
        link
      )
    ) {
      continue;
    }

    /*
     * عنوان کاملاً یکسان
     */

    if (
      title &&
      exactTitles.has(
        title
      )
    ) {
      continue;
    }

    /*
     * تشخیص خبرهای تقریباً یکسان
     * بین چند منبع مختلف.
     */

    let duplicate =
      false;

    for (
      const existing of result
    ) {
      const similarity =
        titleSimilarity(
          title,
          existing.title
        );

      if (
        similarity >= 0.78
      ) {
        duplicate = true;
        break;
      }
    }

    if (
      duplicate
    ) {
      continue;
    }

    if (
      link
    ) {
      exactLinks.add(
        link
      );
    }

    if (
      title
    ) {
      exactTitles.add(
        title
      );
    }

    result.push(
      item
    );
  }

  return result;
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
    Array.isArray(
      sources
    )
      ? sources.filter(
          source =>
            source &&
            source.enabled !== false
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

  /*
   * دریافت تک‌تک منابع
   */

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
        items.length > 0
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

  /*
   * حذف تکراری
   */

  const beforeUnique =
    raw.length;

  raw =
    uniqueItems(
      raw
    );

  console.log(
    `بعد از حذف تکراری: ${raw.length}`
  );

  console.log(
    `تکراری حذف‌شده: ${
      beforeUnique -
      raw.length
    }`
  );

  /*
   * فیلتر زمانی
   */

  const recent =
    raw.filter(
      isRecentNews
    );

  console.log(
    `بعد از فیلتر ${MAX_NEWS_AGE_HOURS} ساعت: ${recent.length}`
  );

  /*
   * فیلتر محلی
   */

  const local =
    recent.filter(
      isLocalNews
    );

  console.log(
    `بعد از فیلتر محلی: ${local.length}`
  );

  /*
   * حذف خارجی
   */

  const final =
    local.filter(
      item =>
        !isForeignNews(
          item
        )
    );

  console.log(
    `بعد از حذف اخبار خارجی: ${final.length}`
  );

  /*
   * مرتب‌سازی بر اساس تاریخ
   */

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

  /*
   * محدود کردن خروجی نهایی
   */

  const limited =
    final.slice(
      0,
      MAX_TOTAL_ITEMS
    );

  console.log(
    `تعداد اخبار نهایی: ${limited.length}`
  );

  /*
   * گزارش اخبار
   */

  if (
    limited.length
  ) {
    console.log(
      '================================'
    );

    console.log(
      'اخبار نهایی:'
    );

    limited.forEach(
      (item, index) => {
        console.log(
          `${index + 1}. ${item.title}`
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

        console.log(
          `   تصویر: ${
            item.imageUrl
              ? 'دارد'
              : 'ندارد'
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

  return limited;
}

/* =========================================================
   EXPORT
========================================================= */

module.exports = {
  fetchAllNews,

  fetchSource,

  fetchGoogleNewsSource,

  fetchTelegramSource,

  fetchHtmlSource,

  fetchRssUrl,

  isRecentNews,

  isLocalNews,

  isForeignNews,

  uniqueItems,

  buildGoogleQueries,

  buildGoogleNewsUrl,

  normalizeItem,

  extractImage,

  parseDate,

  containsLocalKeyword
};
