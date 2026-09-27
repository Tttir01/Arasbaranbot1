'use strict';

const Parser = require('rss-parser');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const { loadSources } = require('./sources');

/* =========================================================
   RSS PARSER
   ========================================================= */

const parser = new Parser({
  timeout: 30000,

  headers: {
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36 ArasbaranNewsBot/4.0',

    'Accept':
      'application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',

    'Accept-Language':
      'fa-IR,fa;q=0.9,en;q=0.5'
  }
});


/* =========================================================
   CONFIG
   ========================================================= */

const MAX_NEWS_AGE_HOURS =
  Number(
    process.env.NEWS_MAX_AGE_HOURS || 48
  );


/* =========================================================
   LOCAL KEYWORDS
   ========================================================= */

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

  'قره داغ',
  'قره‌داغ',
  'قره داغی',

  'آذربایجان شرقی',
  'آذربايجان شرقي'
];


/* =========================================================
   FOREIGN KEYWORDS
   ========================================================= */

const FOREIGN_KEYWORDS = [

  'bbc',
  'cnn',
  'reuters',

  'al jazeera',
  'aljazeera',

  'dw',
  'euronews',

  'voa',
  'france24',

  'associated press',

  'new york times',
  'washington post',

  'the guardian',

  'iran international',

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


/* =========================================================
   TEXT NORMALIZATION
   ========================================================= */

function normalizeText(value) {

  return String(value || '')

    .replace(/ي/g, 'ی')
    .replace(/ى/g, 'ی')
    .replace(/ك/g, 'ک')

    .replace(/\u200c/g, ' ')

    .replace(/\s+/g, ' ')

    .trim();
}


/* =========================================================
   CLEAN HTML
   ========================================================= */

function cleanHtml(value) {

  return String(value || '')

    .replace(
      /<script[\s\S]*?<\/script>/gi,
      ' '
    )

    .replace(
      /<style[\s\S]*?<\/style>/gi,
      ' '
    )

    .replace(
      /<[^>]+>/g,
      ' '
    )

    .replace(
      /&nbsp;/gi,
      ' '
    )

    .replace(
      /&amp;/gi,
      '&'
    )

    .replace(
      /&quot;/gi,
      '"'
    )

    .replace(
      /&#39;/gi,
      "'"
    )

    .replace(
      /&#x27;/gi,
      "'"
    )

    .replace(
      /\s+/g,
      ' '
    )

    .trim();
}


/* =========================================================
   ABSOLUTE URL
   ========================================================= */

function absoluteUrl(base, value) {

  if (!value) {
    return '';
  }

  try {

    return new URL(
      value,
      base
    ).href;

  } catch (error) {

    return '';
  }
}


/* =========================================================
   HTTP GET
   ========================================================= */

function httpGet(url, redirects) {

  redirects =
    redirects || 0;

  return new Promise(
    (resolve, reject) => {

      if (redirects > 5) {

        reject(
          new Error(
            'تعداد redirect بیش از حد مجاز است'
          )
        );

        return;
      }


      let parsed;

      try {

        parsed =
          new URL(url);

      } catch (error) {

        reject(
          new Error(
            `URL نامعتبر: ${url}`
          )
        );

        return;
      }


      const client =
        parsed.protocol === 'https:'
          ? https
          : http;


      const request =
        client.get(

          parsed,

          {

            headers: {

              'User-Agent':
                'Mozilla/5.0 ArasbaranNewsBot/4.0',

              'Accept':
                'application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',

              'Accept-Language':
                'fa-IR,fa;q=0.9,en;q=0.5',

              'Cache-Control':
                'no-cache',

              'Pragma':
                'no-cache'
            }

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
                absoluteUrl(
                  url,
                  response.headers.location
                );


              response.resume();


              httpGet(
                nextUrl,
                redirects + 1
              )

                .then(resolve)

                .catch(reject);


              return;
            }


            let body = '';


            response.setEncoding(
              'utf8'
            );


            response.on(
              'data',
              chunk => {

                body += chunk;

              }
            );


            response.on(
              'end',
              () => {

                console.log(
                  `   HTTP ${status} | ${body.length} bytes | ${url}`
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


                resolve(body);

              }
            );

          }
        );


      request.setTimeout(
        30000,
        () => {

          request.destroy(
            new Error(
              'HTTP timeout'
            )
          );

        }
      );


      request.on(
        'error',
        reject
      );

    }
  );
}


/* =========================================================
   DATE PARSER
   ========================================================= */

function parseDate(value) {

  if (!value) {
    return null;
  }


  const date =
    new Date(value);


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return null;
  }


  return date;
}


/* =========================================================
   IMAGE EXTRACTION
   ========================================================= */

function extractImage(item) {

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
      String(
        item.enclosure.type || ''
      ).toLowerCase();


    if (
      !type ||
      type.indexOf(
        'image/'
      ) === 0
    ) {

      return item.enclosure.url;
    }
  }


  /*
   * image
   */

  if (
    item.image &&
    typeof item.image === 'string'
  ) {

    return item.image;
  }


  /*
   * media thumbnail
   */

  if (
    item['media:thumbnail'] &&
    item['media:thumbnail']['$']
  ) {

    return (
      item['media:thumbnail']['$'].url ||
      ''
    );
  }


  /*
   * media content
   */

  if (
    item['media:content'] &&
    item['media:content']['$']
  ) {

    const media =
      item['media:content']['$'];


    if (
      !media.type ||
      String(
        media.type
      )
        .toLowerCase()
        .indexOf('image/') === 0
    ) {

      return (
        media.url ||
        ''
      );
    }
  }


  /*
   * image inside description
   */

  const html =
    item.content ||
    item.description ||
    '';


  const match =
    String(html).match(
      /<img[^>]+src=["']([^"']+)["']/i
    );


  if (match) {

    return match[1];
  }


  return '';
}


/* =========================================================
   NORMALIZE RSS ITEM
   ========================================================= */

function normalizeItem(
  item,
  source
) {

  const title =
    cleanHtml(
      item.title ||
      item.name ||
      'خبر جدید'
    );


  const description =
    cleanHtml(

      item.contentSnippet ||

      item.description ||

      item.content ||

      item.summary ||

      ''

    );


  const link =
    item.link ||
    item.url ||
    '';


  const date =
    parseDate(

      item.isoDate ||

      item.pubDate ||

      item.published ||

      item.publishedAt ||

      item.date

    );


  const idBase = [

    source.id,

    title,

    link,

    date
      ? date.toISOString()
      : ''

  ].join('|');


  const id =
    item.guid ||
    item.id ||
    crypto
      .createHash('sha256')
      .update(idBase)
      .digest('hex');


  return {

    id: String(id),

    sourceId:
      source.id,

    sourceName:
      item.sourceName ||
      source.name,

    title,

    description,

    content:
      description,

    link,

    publishedAt:
      date
        ? date.toISOString()
        : null,

    imageUrl:
      extractImage(item),

    videoUrl:
      item.videoUrl ||
      '',

    areas:
      Array.isArray(
        source.areas
      )
        ? source.areas
        : []

  };
}


/* =========================================================
   RSS FETCHER
   ========================================================= */

async function fetchRssSource(
  source
) {

  console.log(
    `📡 RSS شروع: ${source.name}`
  );


  console.log(
    `   URL: ${source.url}`
  );


  try {

    /*
     * دریافت مستقیم XML
     *
     * به جای:
     *
     * parser.parseURL()
     *
     * از:
     *
     * httpGet()
     * +
     * parser.parseString()
     *
     * استفاده می‌کنیم.
     */

    const xml =
      await httpGet(
        source.url
      );


    console.log(
      `   RSS bytes: ${xml.length}`
    );


    if (
      !xml ||
      !xml.trim()
    ) {

      throw new Error(
        'پاسخ RSS خالی است'
      );
    }


    /*
     * بررسی اولیه
     */

    const beginning =
      xml
        .trim()
        .substring(
          0,
          120
        );


    console.log(
      `   RSS شروع متن: ${beginning}`
    );


    /*
     * Parse XML
     */

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


    if (
      items.length === 0
    ) {

      console.log(
        `⚠️ RSS بدون خبر: ${source.name}`
      );

      return [];
    }


    /*
     * نمایش نمونه اول
     */

    console.log(
      `   نمونه خبر: ${
        items[0].title ||
        'بدون عنوان'
      }`
    );


    return items.map(
      item =>
        normalizeItem(
          item,
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
   RECENT NEWS
   ========================================================= */

function isRecentNews(
  item,
  hours
) {

  hours =
    hours ||
    MAX_NEWS_AGE_HOURS;


  /*
   * اگر تاریخ وجود نداشت
   * فعلاً خبر را حذف نمی‌کنیم.
   */

  if (
    !item.publishedAt
  ) {

    console.log(
      `⚠️ بدون تاریخ؛ فعلاً حذف نمی‌شود: ${item.title}`
    );


    return true;
  }


  const time =
    new Date(
      item.publishedAt
    ).getTime();


  if (
    Number.isNaN(time)
  ) {

    console.log(
      `⚠️ تاریخ نامعتبر؛ فعلاً حذف نمی‌شود: ${item.title}`
    );


    return true;
  }


  const age =
    (
      Date.now() -
      time
    ) /
    3600000;


  return (

    age >= -6 &&

    age <= hours

  );
}


/* =========================================================
   LOCAL NEWS FILTER
   ========================================================= */

function isLocalNews(
  item
) {

  const text =
    normalizeText(

      [

        item.title,

        item.description,

        item.sourceName,

        item.link

      ].join(' ')

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


/* =========================================================
   FOREIGN NEWS FILTER
   ========================================================= */

function isForeignNews(
  item
) {

  const text =
    normalizeText(

      [

        item.title,

        item.description,

        item.sourceName,

        item.link

      ].join(' ')

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


/* =========================================================
   DEDUPLICATION
   ========================================================= */

function deduplicate(
  items
) {

  const map =
    new Map();


  for (
    const item of items
  ) {

    const key =
      item.link ||
      item.id ||
      item.title;


    if (
      key &&
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
   SOURCE FETCH
   ========================================================= */

async function fetchSource(
  source
) {

  if (!source) {
    return [];
  }


  /*
   * RSS
   */

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


/* =========================================================
   MAIN NEWS FETCHER
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
    `حداکثر سن خبر: ${MAX_NEWS_AGE_HOURS} ساعت`
  );


  console.log(
    '================================'
  );


  let rawItems = [];


  let successSources =
    0;


  let failedSources =
    0;


  /*
   * دریافت منابع
   */

  for (
    const source of sources
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

        successSources++;

      } else {

        failedSources++;

      }


      rawItems =
        rawItems.concat(
          items
        );

    } catch (error) {

      failedSources++;


      console.error(
        `❌ خطای منبع ${source.name}: ${error.message}`
      );

    }

  }


  /*
   * آمار منابع
   */

  console.log(
    `منابع دارای خروجی: ${successSources}`
  );


  console.log(
    `منابع بدون خروجی/ناموفق: ${failedSources}`
  );


  console.log(
    `کل اخبار خام: ${rawItems.length}`
  );


  /*
   * حذف تکراری
   */

  const unique =
    deduplicate(
      rawItems
    );


  console.log(
    `بعد از حذف تکراری: ${unique.length}`
  );


  /*
   * فیلتر زمان
   */

  const recent =
    unique.filter(
      item =>
        isRecentNews(
          item,
          MAX_NEWS_AGE_HOURS
        )
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
   * حذف منابع/موضوعات خارجی
   */

  const nonForeign =
    local.filter(
      item =>
        !isForeignNews(
          item
        )
    );


  console.log(
    `بعد از حذف منابع خارجی: ${nonForeign.length}`
  );


  /*
   * مرتب‌سازی
   */

  nonForeign.sort(
    (a, b) => {

      const dateA =
        a.publishedAt
          ? new Date(
              a.publishedAt
            ).getTime()
          : 0;


      const dateB =
        b.publishedAt
          ? new Date(
              b.publishedAt
            ).getTime()
          : 0;


      return dateB - dateA;

    }
  );


  /*
   * محدودیت نهایی
   */

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


  /*
   * نمایش خروجی نهایی
   */

  if (
    finalItems.length > 0
  ) {

    console.log(
      '-------------------------------'
    );


    finalItems.forEach(
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
          `   لینک: ${item.link}`
        );

      }
    );


    console.log(
      '-------------------------------'
    );

  }


  return finalItems;
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {

  fetchAllNews,

  fetchSource,

  fetchRssSource,

  isRecentNews,

  isLocalNews,

  isForeignNews,

  deduplicate,

  normalizeItem

};
