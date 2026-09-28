'use strict';

/**
 * ARASBARAN NEWS BOT
 * src/news.js
 *
 * وظایف:
 * - دریافت اخبار RSS / Telegram / HTML
 * - نرمال‌سازی متن فارسی
 * - حذف امضا، لینک و تبلیغات کانال
 * - استخراج تاریخ واقعی خبر
 * - تبدیل تاریخ برای نمایش
 * - حذف اخبار قدیمی
 * - حذف اخبار تکراری
 * - تشخیص خبر ناقص
 * - استخراج تصویر
 * - آماده‌سازی خبر برای ارسال به Telegram
 *
 * خروجی هر خبر:
 * {
 *   title,
 *   description,
 *   content,
 *   text,
 *   source,
 *   sourceUrl,
 *   url,
 *   publishedAt,
 *   publishedAtFormatted,
 *   imageUrl,
 *   imageBuffer,
 *   location,
 *   hash
 * }
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const DEFAULT_TIMEOUT =
  Number(process.env.REQUEST_TIMEOUT || 25000);

const MAX_ITEMS_PER_SOURCE =
  Number(process.env.MAX_ITEMS_PER_SOURCE || 10);

const MAX_TOTAL_ITEMS =
  Number(process.env.MAX_TOTAL_ITEMS || 30);

const NEWS_MAX_AGE_HOURS =
  Number(process.env.NEWS_MAX_AGE_HOURS || 48);

const TIMEZONE =
  process.env.TIMEZONE || 'Asia/Tehran';

/* -------------------------------------------------------
 * ابزارهای عمومی
 * ----------------------------------------------------- */

function cleanText(value) {
  if (value === undefined || value === null) {
    return '';
  }

  let text = String(value);

  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');

  text = text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

function normalizePersian(text) {
  return cleanText(text)
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ۀ/g, 'ه')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/إ|أ/g, 'ا')
    .replace(/‌/g, ' ')
    .replace(/\u200c/g, ' ')
    .replace(/[٠-٩]/g, function (ch) {
      return String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch));
    })
    .replace(/[۰-۹]/g, function (ch) {
      return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch));
    })
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function normalizeForCompare(text) {
  return normalizePersian(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/www\.\S+/gi, ' ')
    .replace(/[@#][\w\u0600-\u06ff_]+/g, ' ')
    .replace(/[^\u0600-\u06ffa-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sha1(text) {
  return crypto
    .createHash('sha1')
    .update(String(text || ''), 'utf8')
    .digest('hex');
}

function firstNonEmpty() {
  for (let i = 0; i < arguments.length; i++) {
    const value = arguments[i];

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ''
    ) {
      return String(value).trim();
    }
  }

  return '';
}

/* -------------------------------------------------------
 * حذف لینک و امضای کانال
 * ----------------------------------------------------- */

function removeUrls(text) {
  return String(text || '')
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/www\.[^\s]+/gi, ' ')
    .replace(/\bt\.me\/[^\s]+/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function removeTelegramSignatures(text) {
  let result = String(text || '');

  /*
   * لینک‌های تلگرام
   */
  result = result.replace(
    /https?:\/\/t\.me\/[^\s]+/gi,
    ' '
  );

  result = result.replace(
    /https?:\/\/telegram\.me\/[^\s]+/gi,
    ' '
  );

  /*
   * آیدی کانال‌ها
   */
  result = result.replace(
    /(?:^|\s)@[A-Za-z0-9_]{4,64}\b/g,
    ' '
  );

  /*
   * امضاهای رایج هوراند خبر
   */
  result = result.replace(
    /👁?‍?🗨?\s*ه+ــــ?وران+ـــ?د\s*خب+ــــ?ر/gi,
    ' '
  );

  result = result.replace(
    /ه+ــــ?وران+ـــ?د\s*خب+ــــ?ر/gi,
    ' '
  );

  /*
   * امضاهای عمومی
   */
  result = result.replace(
    /عضویت\s+در\s+کانال/gi,
    ' '
  );

  result = result.replace(
    /لینک\s+عضویت/gi,
    ' '
  );

  result = result.replace(
    /برای\s+عضویت\s+کلیک\s+کنید/gi,
    ' '
  );

  result = result.replace(
    /کانال\s+ما/gi,
    ' '
  );

  result = result.replace(
    /ارسال\s+برای\s+دوستان/gi,
    ' '
  );

  result = result.replace(
    /ما را در .*? دنبال کنید/gi,
    ' '
  );

  /*
   * هشتگ‌های صرفاً منبعی
   */
  result = result.replace(
    /#هوراند_خبر/gi,
    ' '
  );

  result = result.replace(
    /#هوراندخبر/gi,
    ' '
  );

  result = result.replace(
    /#ورزقان_خبری/gi,
    ' '
  );

  result = result.replace(
    /#اخبار_هوراند/gi,
    ' '
  );

  return result
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function removeSourceNoise(text) {
  let result = String(text || '');

  /*
   * حذف لینک‌ها
   */
  result = removeUrls(result);

  /*
   * حذف امضاهای کانال
   */
  result = removeTelegramSignatures(result);

  /*
   * حذف خطوط خالی اضافی
   */
  result = result
    .split('\n')
    .map(function (line) {
      return line.trim();
    })
    .filter(function (line) {
      if (!line) return false;

      if (
        /^🆔\s*@/i.test(line) ||
        /^👁/.test(line) ||
        /^🔗/.test(line)
      ) {
        return false;
      }

      if (
        /عضویت در کانال/i.test(line) &&
        line.length < 150
      ) {
        return false;
      }

      return true;
    })
    .join('\n');

  return result
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* -------------------------------------------------------
 * عنوان
 * ----------------------------------------------------- */

function extractTitleFromText(text) {
  const clean = removeSourceNoise(text);

  if (!clean) {
    return '';
  }

  const lines = clean
    .split('\n')
    .map(function (x) {
      return x.trim();
    })
    .filter(Boolean);

  if (!lines.length) {
    return '';
  }

  let title = lines[0];

  title = title
    .replace(/^📰\s*/u, '')
    .replace(/^🔴\s*/u, '')
    .replace(/^🟢\s*/u, '')
    .replace(/^🔵\s*/u, '')
    .replace(/^✅\s*/u, '')
    .replace(/^❗\s*/u, '')
    .replace(/^#هوراند\s*\|\s*/i, '')
    .replace(/^#ورزقان\s*\|\s*/i, '')
    .replace(/^#اهر\s*\|\s*/i, '')
    .replace(/^#کلیبر\s*\|\s*/i, '')
    .replace(/^#خداآفرین\s*\|\s*/i, '')
    .replace(/^#خاروانا\s*\|\s*/i, '')
    .trim();

  return title;
}

/* -------------------------------------------------------
 * تاریخ
 * ----------------------------------------------------- */

function parseDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  const text = String(value).trim();

  if (!text) {
    return null;
  }

  /*
   * Unix timestamp
   */
  if (/^\d{10}$/.test(text)) {
    const d = new Date(Number(text) * 1000);
    return isNaN(d.getTime()) ? null : d;
  }

  if (/^\d{13}$/.test(text)) {
    const d = new Date(Number(text));
    return isNaN(d.getTime()) ? null : d;
  }

  /*
   * ISO / RFC
   */
  const date = new Date(text);

  if (!isNaN(date.getTime())) {
    return date;
  }

  return null;
}

function extractDateFromTelegramText(text) {
  const source = String(text || '');

  /*
   * تاریخ‌هایی مانند:
   * ۲۸ شهریور ۱۴۰۵
   * 28 شهریور 1405
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

  const regex =
    /(\d{1,2}|[۰-۹]{1,2})\s+(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)\s+(\d{4}|[۰-۹]{4})/;

  const match = source.match(regex);

  if (!match) {
    return null;
  }

  const day = Number(
    normalizePersian(match[1])
  );

  const year = Number(
    normalizePersian(match[3])
  );

  const month = months[match[2]];

  if (
    !day ||
    !year ||
    !month ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  /*
   * تبدیل تقریبی شمسی به میلادی با استفاده از Intl
   * در صورت امکان.
   *
   * چون Node به‌صورت مستقیم parser جلالی ندارد،
   * تاریخ میلادی واقعی Telegram در اولویت قرار می‌گیرد.
   */
  return null;
}

function getPublishedDate(item) {
  if (!item) {
    return null;
  }

  const candidates = [
    item.publishedAt,
    item.published,
    item.pubDate,
    item.isoDate,
    item.date,
    item.createdAt,
    item.created_at,
    item.timestamp,
    item.time
  ];

  for (let i = 0; i < candidates.length; i++) {
    const date = parseDate(candidates[i]);

    if (date) {
      return date;
    }
  }

  /*
   * اگر تاریخ در متن Telegram وجود داشته باشد
   */
  const textDate =
    extractDateFromTelegramText(
      firstNonEmpty(
        item.content,
        item.description,
        item.text
      )
    );

  if (textDate) {
    return textDate;
  }

  return null;
}

function isRecent(date, hours) {
  if (!date) {
    return false;
  }

  const age =
    Date.now() - date.getTime();

  /*
   * خبر آینده به‌دلیل اختلاف ساعت/منطقه زمانی
   * رد نمی‌شود، ولی بیشتر از 2 ساعت آینده مشکوک است.
   */
  if (age < -(2 * 60 * 60 * 1000)) {
    return false;
  }

  return age <=
    hours * 60 * 60 * 1000;
}

/* -------------------------------------------------------
 * تبدیل اعداد فارسی
 * ----------------------------------------------------- */

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

function formatDatePersian(date) {
  if (!date) {
    return '';
  }

  /*
   * استفاده از Intl برای تبدیل میلادی به تقویم فارسی
   */
  try {
    const formatter =
      new Intl.DateTimeFormat(
        'fa-IR-u-ca-persian',
        {
          timeZone: TIMEZONE,
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }
      );

    return formatter.format(date);
  } catch (error) {
    /*
     * fallback
     */
    const formatter =
      new Intl.DateTimeFormat(
        'fa-IR',
        {
          timeZone: TIMEZONE,
          dateStyle: 'medium',
          timeStyle: 'short'
        }
      );

    return formatter.format(date);
  }
}

/* -------------------------------------------------------
 * متن خبر
 * ----------------------------------------------------- */

function getArticleText(item) {
  if (!item) {
    return '';
  }

  let text =
    firstNonEmpty(
      item.content,
      item.description,
      item.summary,
      item.text,
      item.title
    );

  text = cleanText(text);
  text = removeSourceNoise(text);

  return text;
}

function getTitle(item) {
  if (!item) {
    return '';
  }

  let title =
    firstNonEmpty(
      item.title,
      extractTitleFromText(item.text),
      extractTitleFromText(item.content),
      extractTitleFromText(item.description)
    );

  title = cleanText(title);

  title = title
    .replace(/^📰\s*/u, '')
    .replace(/^🔴\s*/u, '')
    .replace(/^🟢\s*/u, '')
    .replace(/^🔵\s*/u, '')
    .replace(/^✅\s*/u, '')
    .replace(/^#هوراند\s*\|\s*/i, '')
    .replace(/^#ورزقان\s*\|\s*/i, '')
    .replace(/^#اهر\s*\|\s*/i, '')
    .replace(/^#کلیبر\s*\|\s*/i, '')
    .replace(/^#خداآفرین\s*\|\s*/i, '')
    .replace(/^#خاروانا\s*\|\s*/i, '')
    .trim();

  return removeSourceNoise(title);
}

/* -------------------------------------------------------
 * حذف عنوان از متن
 * ----------------------------------------------------- */

function removeTitleFromBody(title, body) {
  if (!title || !body) {
    return body;
  }

  const normalizedTitle =
    normalizeForCompare(title);

  const lines = body
    .split('\n')
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean);

  const filtered = [];

  lines.forEach(function (line) {
    const normalizedLine =
      normalizeForCompare(line);

    if (
      normalizedLine === normalizedTitle
    ) {
      return;
    }

    filtered.push(line);
  });

  return filtered.join('\n').trim();
}

/* -------------------------------------------------------
 * تشخیص خبر ناقص
 * ----------------------------------------------------- */

function isIncompleteNews(item) {
  if (!item) {
    return true;
  }

  const title = getTitle(item);
  const body = getArticleText(item);

  if (!title) {
    return true;
  }

  /*
   * عنوان خیلی کوتاه
   */
  if (normalizeForCompare(title).length < 12) {
    return true;
  }

  /*
   * مواردی که فقط لینک هستند
   */
  if (
    /^https?:\/\//i.test(title) ||
    /^www\./i.test(title)
  ) {
    return true;
  }

  /*
   * اگر متن بسیار کوتاه باشد
   */
  const cleanBody =
    normalizeForCompare(body);

  if (cleanBody.length < 35) {
    /*
     * برای برخی خبرهای کوتاه،
     * عنوان به‌تنهایی قابل قبول است.
     */
    if (title.length < 35) {
      return true;
    }
  }

  /*
   * پست‌های صرفاً تبلیغاتی
   */
  const advertisingPatterns = [
    /تبلیغ/,
    /فروش ویژه/,
    /تخفیف ویژه/,
    /عضویت در کانال/,
    /ثبت سفارش/,
    /خرید کنید/,
    /لینک خرید/
  ];

  for (let i = 0; i < advertisingPatterns.length; i++) {
    if (
      advertisingPatterns[i].test(
        normalizePersian(title + ' ' + body)
      )
    ) {
      return true;
    }
  }

  return false;
}

/* -------------------------------------------------------
 * موقعیت محلی
 * ----------------------------------------------------- */

const LOCAL_KEYWORDS = [
  'ارسباران',
  'ورزقان',
  'خاروانا',
  'اهر',
  'کلیبر',
  'هوراند',
  'خداآفرین',
  'خدا آفرین',
  'خداآفرین',
  'آذربایجان شرقی',
  'آذربایجان‌شرقی',
  'لقلان',
  'لغلان'
];

function isLocalNews(item) {
  const text =
    normalizePersian(
      [
        getTitle(item),
        getArticleText(item),
        item && item.location
          ? item.location
          : ''
      ].join(' ')
    );

  return LOCAL_KEYWORDS.some(function (keyword) {
    return text.indexOf(
      normalizePersian(keyword)
    ) !== -1;
  });
}

function detectLocation(item) {
  const text =
    normalizePersian(
      [
        getTitle(item),
        getArticleText(item)
      ].join(' ')
    );

  const locations = [
    'ورزقان',
    'خاروانا',
    'اهر',
    'کلیبر',
    'هوراند',
    'خداآفرین',
    'ارسباران'
  ];

  for (let i = 0; i < locations.length; i++) {
    if (
      text.indexOf(
        normalizePersian(locations[i])
      ) !== -1
    ) {
      return locations[i];
    }
  }

  return '';
}

/* -------------------------------------------------------
 * تصویر
 * ----------------------------------------------------- */

function extractImageUrl(item) {
  if (!item) {
    return '';
  }

  const candidates = [
    item.imageUrl,
    item.image,
    item.image_url,
    item.thumbnail,
    item.thumbnailUrl,
    item.enclosureUrl,
    item.mediaUrl,
    item.photoUrl,
    item.photo
  ];

  for (let i = 0; i < candidates.length; i++) {
    const value = candidates[i];

    if (!value) {
      continue;
    }

    if (
      typeof value === 'string' &&
      /^https?:\/\//i.test(value)
    ) {
      return value;
    }
  }

  /*
   * media
   */
  if (
    item.media &&
    typeof item.media === 'string' &&
    /^https?:\/\//i.test(item.media)
  ) {
    return item.media;
  }

  /*
   * enclosure object
   */
  if (
    item.enclosure &&
    item.enclosure.url
  ) {
    return item.enclosure.url;
  }

  return '';
}

/* -------------------------------------------------------
 * دانلود HTTP/HTTPS
 * ----------------------------------------------------- */

function requestBuffer(url, options) {
  options = options || {};

  return new Promise(function (resolve, reject) {
    let parsed;

    try {
      parsed = new URL(url);
    } catch (error) {
      reject(
        new Error('Invalid URL: ' + url)
      );
      return;
    }

    const client =
      parsed.protocol === 'http:'
        ? http
        : https;

    const requestOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: Object.assign(
        {
          'User-Agent':
            'Mozilla/5.0 (compatible; ArasbaranNewsBot/1.0)',
          'Accept':
            options.accept || '*/*'
        },
        options.headers || {}
      )
    };

    const request =
      client.request(
        requestOptions,
        function (response) {
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
            response.resume();

            requestBuffer(
              new URL(
                response.headers.location,
                url
              ).toString(),
              options
            )
              .then(resolve)
              .catch(reject);

            return;
          }

          if (status < 200 || status >= 300) {
            response.resume();

            reject(
              new Error(
                'HTTP ' + status
              )
            );

            return;
          }

          const chunks = [];

          response.on(
            'data',
            function (chunk) {
              chunks.push(chunk);
            }
          );

          response.on(
            'end',
            function () {
              resolve({
                buffer: Buffer.concat(chunks),
                statusCode: status,
                headers: response.headers,
                finalUrl: url
              });
            }
          );
        }
      );

    request.setTimeout(
      options.timeout || DEFAULT_TIMEOUT,
      function () {
        request.destroy(
          new Error('Request timeout')
        );
      }
    );

    request.on(
      'error',
      reject
    );

    request.end();
  });
}

async function downloadImage(url) {
  if (!url) {
    return null;
  }

  try {
    const result =
      await requestBuffer(
        url,
        {
          timeout: DEFAULT_TIMEOUT,
          accept:
            'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
        }
      );

    if (!result.buffer || !result.buffer.length) {
      return null;
    }

    /*
     * محدود کردن حجم تصویر برای جلوگیری
     * از مصرف بیش از حد حافظه
     */
    const maxSize =
      15 * 1024 * 1024;

    if (result.buffer.length > maxSize) {
      return null;
    }

    return result.buffer;
  } catch (error) {
    console.log(
      '⚠️ خطا در دانلود تصویر:',
      error.message
    );

    return null;
  }
}

/* -------------------------------------------------------
 * ساخت Hash
 * ----------------------------------------------------- */

function createNewsHash(item) {
  if (!item) {
    return '';
  }

  /*
   * اگر شناسه منبع وجود دارد،
   * از آن به‌عنوان بخشی از hash استفاده می‌کنیم.
   */
  const sourceId =
    firstNonEmpty(
      item.id,
      item.guid,
      item.messageId,
      item.message_id,
      item.url
    );

  const title =
    normalizeForCompare(
      getTitle(item)
    );

  const body =
    normalizeForCompare(
      getArticleText(item)
    ).slice(0, 1000);

  const location =
    normalizeForCompare(
      detectLocation(item)
    );

  return sha1(
    [
      sourceId,
      title,
      body,
      location
    ].join('|')
  );
}

/* -------------------------------------------------------
 * شباهت اخبار
 * ----------------------------------------------------- */

function similarityScore(a, b) {
  const aa =
    normalizeForCompare(a);

  const bb =
    normalizeForCompare(b);

  if (!aa || !bb) {
    return 0;
  }

  if (aa === bb) {
    return 1;
  }

  const wordsA =
    new Set(
      aa.split(' ').filter(Boolean)
    );

  const wordsB =
    new Set(
      bb.split(' ').filter(Boolean)
    );

  let intersection = 0;

  wordsA.forEach(function (word) {
    if (wordsB.has(word)) {
      intersection++;
    }
  });

  const union =
    new Set(
      Array.from(wordsA).concat(
        Array.from(wordsB)
      )
    ).size;

  if (!union) {
    return 0;
  }

  return intersection / union;
}

function isDuplicateNews(candidate, accepted) {
  if (!candidate || !accepted) {
    return false;
  }

  const candidateHash =
    candidate.hash ||
    createNewsHash(candidate);

  for (let i = 0; i < accepted.length; i++) {
    const current =
      accepted[i];

    if (!current) {
      continue;
    }

    const currentHash =
      current.hash ||
      createNewsHash(current);

    if (
      candidateHash &&
      currentHash &&
      candidateHash === currentHash
    ) {
      return true;
    }

    const titleSimilarity =
      similarityScore(
        getTitle(candidate),
        getTitle(current)
      );

    if (titleSimilarity >= 0.82) {
      return true;
    }

    const bodySimilarity =
      similarityScore(
        getArticleText(candidate),
        getArticleText(current)
      );

    if (bodySimilarity >= 0.90) {
      return true;
    }
  }

  return false;
}

/* -------------------------------------------------------
 * پاک‌سازی و آماده‌سازی خبر
 * ----------------------------------------------------- */

function normalizeNewsItem(raw, source) {
  if (!raw) {
    return null;
  }

  const item =
    Object.assign({}, raw);

  item.source =
    firstNonEmpty(
      raw.source,
      source && source.name,
      'منبع نامشخص'
    );

  item.sourceUrl =
    firstNonEmpty(
      raw.sourceUrl,
      source && source.url,
      ''
    );

  item.url =
    firstNonEmpty(
      raw.url,
      raw.link,
      raw.guid,
      ''
    );

  item.title =
    getTitle(raw);

  let body =
    getArticleText(raw);

  body =
    removeTitleFromBody(
      item.title,
      body
    );

  body =
    removeSourceNoise(body);

  item.content =
    body;

  item.description =
    body;

  item.text =
    item.title +
    (body
      ? '\n' + body
      : '');

  item.publishedDate =
    getPublishedDate(raw);

  item.publishedAt =
    item.publishedDate
      ? item.publishedDate.toISOString()
      : null;

  item.publishedAtFormatted =
    item.publishedDate
      ? formatDatePersian(
          item.publishedDate
        )
     
