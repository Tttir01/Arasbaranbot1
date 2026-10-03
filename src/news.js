'use strict';

/**
 * ============================================================
 * ARASBARAN NEWS BOT
 * src/news.js
 * ============================================================
 *
 * نسخه کامل:
 *
 * 1. RSS
 * 2. Google News RSS
 * 3. Telegram public channels
 * 4. HTML sources
 * 5. Tasnim article pages
 *
 * فیلتر تخصصی:
 * ورزقان / خاروانا / اهر / کلیبر / هوراند / خداآفرین / ارسباران
 *
 * حذف:
 * - فال حافظ
 * - فال روزانه
 * - طالع بینی
 * - سرگرمی
 * - تبلیغات
 * - فروش
 * - آگهی
 * - اخبار ملی نامرتبط
 * - اخبار خارجی
 * - اخبار قدیمی
 * - اخبار تکراری
 *
 * نکته:
 * نام کانال به تنهایی معیار محلی بودن نیست.
 * محتوای خود خبر باید ارتباط محلی داشته باشد.
 *
 * Node.js >= 18
 * ============================================================
 */

const Parser = require('rss-parser');
const cheerio = require('cheerio');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const parser = new Parser({
  timeout: Number(process.env.REQUEST_TIMEOUT || 25000),
  headers: {
    'User-Agent':
      'Mozilla/5.0 (compatible; ArasbaranNewsBot/3.0)'
  }
});

const REQUEST_TIMEOUT =
  Number(process.env.REQUEST_TIMEOUT || 25000);

const MAX_ITEMS_PER_SOURCE =
  Number(process.env.MAX_ITEMS_PER_SOURCE || 10);

const MAX_TOTAL_ITEMS =
  Number(process.env.MAX_TOTAL_ITEMS || 30);

const NEWS_MAX_AGE_HOURS =
  Number(process.env.NEWS_MAX_AGE_HOURS || 24);

const TIMEZONE =
  process.env.TIMEZONE || 'Asia/Tehran';

const REQUIRE_NEWS_DATE =
  String(process.env.REQUIRE_NEWS_DATE || 'false')
    .toLowerCase() === 'true';


/* ============================================================
 * ابزارهای عمومی
 * ============================================================
 */

function cleanText(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return '';
  }

  let text = String(value);

  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#039;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


function normalizePersian(text) {
  return cleanText(text)
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ۀ/g, 'ه')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/[إأ]/g, 'ا')
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


function firstNonEmpty() {
  for (let i = 0; i < arguments.length; i++) {
    if (
      arguments[i] !== undefined &&
      arguments[i] !== null &&
      String(arguments[i]).trim() !== ''
    ) {
      return String(arguments[i]).trim();
    }
  }

  return '';
}


function sha1(value) {
  return crypto
    .createHash('sha1')
    .update(String(value || ''), 'utf8')
    .digest('hex');
}


/* ============================================================
 * حذف لینک‌ها و امضاهای کانال
 * ============================================================
 */

function removeUrls(text) {
  return String(text || '')
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/www\.[^\s]+/gi, ' ')
    .replace(/\bt\.me\/[^\s]+/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}


function removeChannelSignatures(text) {
  let result = String(text || '');

  /* لینک تلگرام */
  result = result.replace(
    /https?:\/\/t\.me\/[^\s]+/gi,
    ' '
  );

  result = result.replace(
    /https?:\/\/telegram\.me\/[^\s]+/gi,
    ' '
  );

  /* آیدی کانال */
  result = result.replace(
    /(?:^|\s)@[A-Za-z0-9_]{4,64}\b/g,
    ' '
  );

  /* امضای هوراند خبر */
  result = result.replace(
    /👁[\s\S]{0,10}?ه+[\s\S]{0,15}?وران+[\s\S]{0,15}?خب+[\s\S]{0,15}?ر/gi,
    ' '
  );

  result = result.replace(
    /ه+ــــ?وران+ـــ?د\s*خب+ــــ?ر/gi,
    ' '
  );

  /* امضاهای عمومی */
  const signaturePatterns = [
    /عضویت\s+در\s+کانال/gi,
    /لینک\s+عضویت/gi,
    /برای\s+عضویت\s+کلیک\s+کنید/gi,
    /ارسال\s+برای\s+دوستان/gi,
    /ما را در اینستاگرام دنبال کنید/gi,
    /ارتباط با ادمین/gi,
    /سفارش آگهی/gi,
    /تبلیغات/gi
  ];

  signaturePatterns.forEach(function (pattern) {
    result = result.replace(pattern, ' ');
  });

  /* آیدی‌های شناخته‌شده کانال‌ها */
  [
    'horand_khabar',
    'varzaghan_khabari',
    'AharNews',
    'kaleibar_ir',
    'Farmandarikhodaafarin'
  ].forEach(function (id) {
    const pattern =
      new RegExp(
        '@' + id + '\\b',
        'gi'
      );

    result = result.replace(pattern, ' ');
  });

  return result
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


function removeSourceNoise(text) {
  let result =
    removeChannelSignatures(text);

  result =
    removeUrls(result);

  const lines =
    result
      .split('\n')
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);

  const filtered = [];

  lines.forEach(function (line) {
    if (
      /^🔗/u.test(line)
    ) {
      return;
    }

    if (
      /^🆔/u.test(line)
    ) {
      return;
    }

    if (
      /^👁/u.test(line)
    ) {
      return;
    }

    if (
      /instagram\.com/i.test(line)
    ) {
      return;
    }

    if (
      /telegram\.me/i.test(line)
    ) {
      return;
    }

    if (
      /t\.me\//i.test(line)
    ) {
      return;
    }

    filtered.push(line);
  });

  return filtered
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


/* ============================================================
 * کلمات محلی
 * ============================================================
 */

const LOCAL_AREAS = {
  varzqan: [
    'ورزقان',
    'شهرستان ورزقان',
    'بخش مرکزی ورزقان',
    'خاروانا',
    'بخش خاروانا',
    'دیزمار',
    'جوشین',
    'سونگون',
    'مس سونگون'
  ],

  kharvana: [
    'خاروانا',
    'بخش خاروانا',
    'دیزمار'
  ]
};


/* ============================================================
 * دستگاه‌ها و ادارات محلی
 * ============================================================
 */

const LOCAL_ORGANIZATIONS = [
  'فرمانداری',
  'بخشداری',
  'دهیاری',
  'شورای اسلامی',
  'شورای شهر',
  'شهرداری',

  'آموزش و پرورش',
  'اداره آموزش و پرورش',
  'مدیریت آموزش و پرورش',

  'دانشگاه',
  'دانشگاه آزاد',
  'پیام نور',

  'شبکه بهداشت',
  'بهداشت و درمان',
  'بیمارستان',
  'مرکز بهداشت',
  'اورژانس',

  'جهاد کشاورزی',
  'اداره جهاد کشاورزی',

  'اداره برق',
  'شرکت برق',
  'برق منطقه',

  'اداره گاز',
  'شرکت گاز',

  'آب و فاضلاب',
  'آبفا',

  'راهداری',
  'حمل و نقل جاده‌ای',
  'حمل‌ونقل جاده‌ای',

  'مخابرات',

  'هلال احمر',
  'جمعیت هلال احمر',

  'کمیته امداد',
  'بهزیستی',

  'بنیاد مسکن',

  'منابع طبیعی',
  'محیط زیست',
  'محیط‌زیست',

  'میراث فرهنگی',
  'گردشگری',

  'اداره تعاون',
  'اداره کار',
  'تعاون، کار و رفاه اجتماعی',

  'صمت',
  'صنعت، معدن و تجارت',

  'اتاق اصناف',
  'اصناف',

  'بانک',
  'اداره پست',

  'ثبت احوال',
  'ثبت اسناد',

  'دادگستری',
  'دادستانی',
  'دادگاه',

  'نیروی انتظامی',
  'فراجا',
  'پلیس',

  'آتش نشانی',
  'آتش‌نشانی',

  'بسیج',
  'سپاه',

  'اداره ورزش و جوانان',
  'ورزش و جوانان',

  'اداره فرهنگ و ارشاد',
  'فرهنگ و ارشاد',

  'اداره اوقاف',
  'اوقاف',

  'امور عشایر',
  'عشایر',

  'منابع آب',
  'شرکت آب منطقه‌ای',

  'مس سونگون',
  'مجتمع مس سونگون',
  'سونگون'
];


/* ============================================================
 * موضوعات خبری قابل قبول
 * ============================================================
 */

const LOCAL_NEWS_TOPICS = [
  'حادثه',
  'تصادف',
  'آتش سوزی',
  'آتش‌سوزی',
  'زلزله',
  'سیل',
  'بارندگی',
  'برف',
  'رانش زمین',
  'ریزش',
  'قطعی برق',
  'قطعی آب',
  'قطعی گاز',
  'قطعی اینترنت',
  'اختلال ارتباطات',
  'فیبر نوری',

  'مدرسه',
  'دانش آموز',
  'دانش‌آموز',
  'معلم',
  'فرهنگیان',
  'دانشگاه',

  'کشاورزی',
  'دامداری',
  'دامپزشکی',
  'باغداری',
  'آبیاری',
  'آب کشاورزی',

  'راه',
  'جاده',
  'پل',
  'روستا',
  'روستایی',

  'اشتغال',
  'کارآفرینی',
  'تولید',
  'سرمایه گذاری',
  'سرمایه‌گذاری',

  'مسکن',
  'زمین',
  'نهضت ملی مسکن',

  'سلامت',
  'پزشکی',
  'درمان',
  'بیمارستان',

  'انتخابات',
  'جلسه شورای',
  'جلسه فرمانداری',

  'بودجه شهرستان',
  'پروژه',
  'افتتاح',
  'بهره برداری',
  'بهره‌برداری',

  'آب رسانی',
  'آبرسانی',
  'گازرسانی',
  'برق رسانی',
  'برق‌رسانی',

  'گردشگری',
  'طبیعت',
  'محیط زیست',
  'محیط‌زیست',

  'حیات وحش',
  'شکار غیرمجاز',

  'بازار',
  'اصناف',
  'قیمت کالا',

  'خدمت رسانی',
  'خدمت‌رسانی',
  'دیدار',
  'جلسه',
  'فرماندار',
  'فرمانداری',
  'بخشدار',
  'بخشداری',
  'مدیر',
  'مدیریت',
  'رئیس',
  'رییس',
  'معاون',
  'مسئول',
  'معرفی رئیس',
  'معرفی مدیر',
  'تغییر مدیر',
  'انتصاب',
  'تودیع',
  'معارفه',

  'مدیر جدید',
  'رئیس جدید',
  'رییس جدید',

  'اقتصاد',
  'توسعه',
  'معدن',
  'مس',
  'سونگون',
  'ترانزیت',
  'صنعت',
  'معدن و تجارت',

  'تقدیر',
  'تجلیل',

  'اطلاعیه',
  'فراخوان',
  'هشدار',
  'اطلاع رسانی',
  'اطلاع‌رسانی'
];


/* ============================================================
 * موضوعات ممنوع
 * ============================================================
 */

const BLOCKED_PATTERNS = [
  /فال\s*حافظ/i,
  /فال\s*روز/i,
  /فال\s*هفتگی/i,
  /فال\s*ماهانه/i,
  /فال\s*امروز/i,
  /طالع\s*بینی/i,
  /طالع‌بینی/i,
  /فال\s*قهوه/i,
  /فال\s*تاروت/i,
  /استخاره/i,

  /جوک/i,
  /طنز/i,
  /سرگرمی/i,
  /معما/i,
  /چیستان/i,

  /تبلیغات/i,
  /تبلیغاتی/i,
  /رپورتاژ\s*آگهی/i,
  /سفارش\s*آگهی/i,

  /فروش\s+ویژه/i,
  /فروش\s+اقساطی/i,
  /خرید\s+و\s+فروش/i,
  /قیمت\s+روز\s+خودرو/i,
  /فروش\s+زمین/i,
  /فروش\s+خانه/i,
  /فروش\s+ویلا/i,

  /کد\s+تخفیف/i,
  /تخفیف\s+ویژه/i,

  /استخدام\s+فوری/i,
  /درآمد\s+با\s+گوشی/i,
  /درآمد\s+روزانه/i,

  /قرعه\s+کشی/i,
  /قرعه‌کشی/i,

  /مسابقه\s+اینستاگرامی/i,
  /لینک\s+خرید/i,

  /پیشگویی/i,
  /طالع/i
];


/* ============================================================
 * اخبار خارجی
 * ============================================================
 */

const FOREIGN_PATTERNS = [
  /ترامپ/i,
  /پوتین/i,
  /زلنسکی/i,
  /اوکراین/i,
  /روسیه/i,
  /آمریکا/i,
  /اسرائیل/i,
  /غزه/i,
  /فلسطین/i,
  /لبنان/i,
  /سوریه/i,
  /عراق/i,
  /افغانستان/i,
  /پاکستان/i,
  /چین/i,
  /کره شمالی/i,
  /اروپا/i,
  /انگلیس/i,
  /بریتانیا/i,
  /فرانسه/i,
  /آلمان/i
];


/* ============================================================
 * تشخیص محلی بودن
 * ============================================================
 *
 * نکته مهم:
 * source.name به‌تنهایی بررسی نمی‌شود.
 *
 * مثال:
 * اگر کانال هوراند خبر یک خبر ملی منتشر کند،
 * صرفاً به‌خاطر اینکه از کانال هوراند آمده،
 * خبر محلی محسوب نمی‌شود.
 * ============================================================
 */

function containsAny(text, list) {
  const value =
    normalizePersian(text);

  return list.some(function (keyword) {
    return value.indexOf(
      normalizePersian(keyword)
    ) !== -1;
  });
}


function getNewsSearchText(item) {
  if (!item) {
    return '';
  }

  return normalizePersian(
    [
      item.title,
      item.description,
      item.content,
      item.text,
      item.location
    ]
      .filter(Boolean)
      .join(' ')
  );
}


function hasBlockedContent(item) {
  const text =
    getNewsSearchText(item);

  return BLOCKED_PATTERNS.some(
    function (pattern) {
      return pattern.test(text);
    }
  );
}


function isForeignNews(item) {
  const text = getNewsSearchText(item);

  const hasTargetArea = containsAny(
    text,
    [].concat(
      LOCAL_AREAS.varzqan,
      LOCAL_AREAS.kharvana
    )
  );

  if (hasTargetArea) {
    return false;
  }

  return FOREIGN_PATTERNS.some(function (pattern) {
    return pattern.test(text);
  });
}


/* ============================================================
 * تشخیص حوزه شهرستان
 * ============================================================
 */

function detectLocation(item) {
  const text = getNewsSearchText(item);

  if (containsAny(text, LOCAL_AREAS.kharvana)) {
    return 'خاروانا';
  }

  if (containsAny(text, LOCAL_AREAS.varzqan)) {
    return 'ورزقان';
  }

  return '';
}


/* ============================================================
 * فیلتر تخصصی ورزقان
 * ============================================================
 */

function isVarzqanRelevant(item) {
  const text =
    getNewsSearchText(item);

  /*
   * خبر مستقیم ورزقان
   */
  if (
    containsAny(
      text,
      LOCAL_AREAS.varzqan
    )
  ) {
    return true;
  }

  /*
   * خبر مربوط به اداره‌ای که در عنوان/متن
   * صراحتاً با ورزقان مرتبط شده باشد.
   *
   * مثال:
   * رئیس اداره گاز ورزقان
   */
  if (
    containsAny(
      text,
      LOCAL_ORGANIZATIONS
    ) &&
    /ورزقان|خاروانا|سونگون/i.test(text)
  ) {
    return true;
  }

  return false;
}


/* ============================================================
 * فیلتر تخصصی هوراند
 * ============================================================
 */

function isHorandRelevant(item) {
  const text =
    getNewsSearchText(item);

  if (
    containsAny(
      text,
      LOCAL_AREAS.horand
    )
  ) {
    return true;
  }

  /*
   * خبر اداره‌ای هوراند
   */
  if (
    containsAny(
      text,
      LOCAL_ORGANIZATIONS
    ) &&
    /هوراند/i.test(text)
  ) {
    return true;
  }

  return false;
}


/* ============================================================
 * فیلتر تخصصی اهر
 * ============================================================
 */

function isAharRelevant(item) {
  const text =
    getNewsSearchText(item);

  if (
    containsAny(
      text,
      LOCAL_AREAS.ahar
    )
  ) {
    return true;
  }

  if (
    containsAny(
      text,
      LOCAL_ORGANIZATIONS
    ) &&
    /اهر/i.test(text)
  ) {
    return true;
  }

  return false;
}


/* ============================================================
 * فیلتر تخصصی کلیبر
 * ============================================================
 */

function isKaleybarRelevant(item) {
  const text =
    getNewsSearchText(item);

  if (
    containsAny(
      text,
      LOCAL_AREAS.kaleybar
    )
  ) {
    return true;
  }

  if (
    containsAny(
      text,
      LOCAL_ORGANIZATIONS
    ) &&
    /کلیبر|آبش[\s‌]*احمد/i.test(text)
  ) {
    return true;
  }

  return false;
}


/* ============================================================
 * فیلتر تخصصی خداآفرین
 * ============================================================
 */

function isKhodaAfarinRelevant(item) {
  const text =
    getNewsSearchText(item);

  if (
    containsAny(
      text,
      LOCAL_AREAS.khodaAfarin
    )
  ) {
    return true;
  }

  if (
    containsAny(
      text,
      LOCAL_ORGANIZATIONS
    ) &&
    /خداآفرین|خدا\s*آفرین/i.test(text)
  ) {
    return true;
  }

  return false;
}


/* ============================================================
 * فیلتر کلی اخبار محلی
 * ============================================================
 */

function isLocalNews(item) {
  if (!item) return false;
  if (hasBlockedContent(item)) return false;

  const text = getNewsSearchText(item);

  const targetArea = containsAny(
    text,
    [].concat(
      LOCAL_AREAS.varzqan,
      LOCAL_AREAS.kharvana
    )
  );

  if (!targetArea) return false;
  if (isForeignNews(item)) return false;

  return true;
}


/* ============================================================
 * تاریخ
 * ============================================================
 */

function parseDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return isNaN(value.getTime())
      ? null
      : value;
  }

  const text =
    String(value).trim();

  if (!text) {
    return null;
  }

  if (/^\d{10}$/.test(text)) {
    const d =
      new Date(
        Number(text) * 1000
      );

    return isNaN(d.getTime())
      ? null
      : d;
  }

  if (/^\d{13}$/.test(text)) {
    const d =
      new Date(
        Number(text)
      );

    return isNaN(d.getTime())
      ? null
      : d;
  }

  const normalizedText = text
    .replace(/[۰-۹]/g, function (ch) {
      return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch));
    })
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک');

  const date =
    new Date(normalizedText);

  if (!isNaN(date.getTime())) {
    return date;
  }

  return null;
}


function extractTelegramDate($) {
  if (!$) {
    return null;
  }

  /*
   * مهم:
   * فقط datetime واقعی پیام Telegram
   */
  const values = [];

  $('time[datetime]').each(
    function () {
      const value =
        $(this).attr('datetime');

      if (value) {
        values.push(value);
      }
    }
  );

  for (let i = 0; i < values.length; i++) {
    const date =
      parseDate(values[i]);

    if (date) {
      return date;
    }
  }

  return null;
}


function getPublishedDate(item) {
  if (!item) {
    return null;
  }

  const candidates = [
    item.publishedAt,
    item.isoDate,
    item.pubDate,
    item.published,
    item.createdAt,
    item.created_at,
    item.timestamp,
    item.date,
    item.time
  ];

  for (
    let i = 0;
    i < candidates.length;
    i++
  ) {
    const date =
      parseDate(
        candidates[i]
      );

    if (date) {
      return date;
    }
  }

  return null;
}


function isRecentNews(item, hours) {
  const date =
    item instanceof Date
      ? item
      : getPublishedDate(item);

  if (!date) {
    return false;
  }

  const maxHours =
    Number(
      hours || NEWS_MAX_AGE_HOURS
    );

  const age =
    Date.now() -
    date.getTime();

  /*
   * خبر بیش از 2 ساعت در آینده
   * معتبر فرض نمی‌شود.
   */
  if (
    age <
    -(2 * 60 * 60 * 1000)
  ) {
    return false;
  }

  return (
    age <=
    maxHours * 60 * 60 * 1000
  );
}


/* ============================================================
 * تاریخ فارسی
 * ============================================================
 */

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


function formatPersianDate(date) {
  if (!date) {
    return '';
  }

  try {
    return new Intl.DateTimeFormat(
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
    ).format(date);
  } catch (error) {
    return new Intl.DateTimeFormat(
      'fa-IR',
      {
        timeZone: TIMEZONE,
        dateStyle: 'medium',
        timeStyle: 'short'
      }
    ).format(date);
  }
}


/* ============================================================
 * عنوان و متن
 * ============================================================
 */

function getTitle(item) {
  if (!item) {
    return '';
  }

  let title =
    firstNonEmpty(
      item.title,
      ''
    );

  title =
    cleanText(title);

  title =
    removeChannelSignatures(
      title
    );

  title =
    title
      .replace(/^📰\s*/u, '')
      .replace(/^🔴\s*/u, '')
      .replace(/^🟢\s*/u, '')
      .replace(/^🔵\s*/u, '')
      .replace(/^✅\s*/u, '')
      .replace(/^❗\s*/u, '')
      .replace(
        /^#هوراند\s*\|\s*/i,
        ''
      )
      .replace(
        /^#ورزقان\s*\|\s*/i,
        ''
      )
      .replace(
        /^#اهر\s*\|\s*/i,
        ''
      )
      .replace(
        /^#کلیبر\s*\|\s*/i,
        ''
      )
      .replace(
        /^#خداآفرین\s*\|\s*/i,
        ''
      )
      .replace(
        /^#خاروانا\s*\|\s*/i,
        ''
      )
      .trim();

  return title;
}


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
      ''
    );

  text =
    cleanText(text);

  text =
    removeSourceNoise(text);

  return text;
}


function removeTitleFromBody(
  title,
  body
) {
  if (!title || !body) {
    return body || '';
  }

  const normalizedTitle =
    normalizeForCompare(title);

  return body
    .split('\n')
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean)
    .filter(function (line) {
      return (
        normalizeForCompare(line) !==
        normalizedTitle
      );
    })
    .join('\n')
    .trim();
}


/* ============================================================
 * تشخیص خبر نامربوط
 * ============================================================
 */

function isIncompleteNews(item) {
  if (!item) {
    return true;
  }

  const title =
    getTitle(item);

  const body =
    getArticleText(item);

  if (!title) {
    return true;
  }

  if (
    normalizeForCompare(title)
      .length < 12
  ) {
    return true;
  }

  if (
    /^https?:\/\//i.test(title)
  ) {
    return true;
  }

  if (
    hasBlockedContent(item)
  ) {
    return true;
  }

  /*
   * فال و سرگرمی حتی اگر متن طولانی باشد
   * نباید عبور کند.
   */
  if (
    BLOCKED_PATTERNS.some(
      function (pattern) {
        return pattern.test(
          title + ' ' + body
        );
      }
    )
  ) {
    return true;
  }

  /*
   * پست‌های خیلی کوتاه
   */
  if (
    normalizeForCompare(body)
      .length < 25 &&
    title.length < 40
  ) {
    return true;
  }

  return false;
}


/* ============================================================
 * تصویر
 * ============================================================
 */

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
    item.mediaUrl,
    item.photoUrl
  ];

  for (
    let i = 0;
    i < candidates.length;
    i++
  ) {
    if (
      typeof candidates[i] === 'string' &&
      /^https?:\/\//i.test(
        candidates[i]
      )
    ) {
      return candidates[i];
    }
  }

  if (
    item.enclosure &&
    item.enclosure.url
  ) {
    return item.enclosure.url;
  }

  return '';
}


/* ============================================================
 * HTTP
 * ============================================================
 */

function requestText(
  url,
  options,
  redirectCount
) {
  options = options || {};
  redirectCount = Number(redirectCount || 0);

  if (redirectCount > 6) {
    return Promise.reject(
      new Error('Redirect limit exceeded')
    );
  }

  return new Promise(
    function (resolve, reject) {
      let parsed;

      try {
        parsed =
          new URL(url);
      } catch (error) {
        reject(error);
        return;
      }

      const client =
        parsed.protocol === 'http:'
          ? http
          : https;

      const request =
        client.request(
          {
            hostname:
              parsed.hostname,
            port:
              parsed.port || undefined,
            path:
              parsed.pathname +
              parsed.search,
            method:
              options.method || 'GET',
            headers:
              Object.assign(
                {
                  'User-Agent':
                    'Mozilla/5.0 (compatible; ArasbaranNewsBot/3.0)',
                  'Accept':
                    options.accept ||
                    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                options.headers || {}
              )
          },
          function (response) {
            const status =
              response.statusCode || 0;

            if (
              status >= 300 &&
              status < 400 &&
              response.headers.location
            ) {
              response.resume();

              const next =
                new URL(
                  response.headers.location,
                  url
                ).toString();

              requestText(
                next,
                options,
                redirectCount + 1
              )
                .then(resolve)
                .catch(reject);

              return;
            }

            if (
              status < 200 ||
              status >= 300
            ) {
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
                resolve(
                  Buffer.concat(
                    chunks
                  ).toString('utf8')
                );
              }
            );
          }
        );

      request.setTimeout(
        options.timeout ||
          REQUEST_TIMEOUT,
        function () {
          request.destroy(
            new Error(
              'Request timeout'
            )
          );
        }
      );

      request.on(
        'error',
        reject
      );

      request.end();
    }
  );
}


function requestBuffer(
  url,
  options
) {
  options = options || {};

  return new Promise(
    function (resolve, reject) {
      let parsed;

      try {
        parsed =
          new URL(url);
      } catch (error) {
        reject(error);
        return;
      }

      const client =
        parsed.protocol === 'http:'
          ? http
          : https;

      const request =
        client.request(
          {
            hostname:
              parsed.hostname,
            port:
              parsed.port || undefined,
            path:
              parsed.pathname +
              parsed.search,
            method:
              options.method || 'GET',
            headers:
              Object.assign(
                {
                  'User-Agent':
                    'Mozilla/5.0 (compatible; ArasbaranNewsBot/3.0)',
                  'Accept':
                    options.accept ||
                    'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
                },
                options.headers || {}
              )
          },
          function (response) {
            const status =
              response.statusCode || 0;

            if (
              status >= 300 &&
              status < 400 &&
              response.headers.location
            ) {
              response.resume();

              const next =
                new URL(
                  response.headers.location,
                  url
                ).toString();

              requestBuffer(
                next,
                options
              )
                .then(resolve)
                .catch(reject);

              return;
            }

            if (
              status < 200 ||
              status >= 300
            ) {
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
                  buffer:
                    Buffer.concat(
                      chunks
                    ),
                  headers:
                    response.headers,
                  statusCode:
                    status
                });
              }
            );
          }
        );

      request.setTimeout(
        options.timeout ||
          REQUEST_TIMEOUT,
        function () {
          request.destroy(
            new Error(
              'Request timeout'
            )
          );
        }
      );

      request.on(
        'error',
        reject
      );

      request.end();
    }
  );
}


async function downloadImage(
  imageUrl
) {
  if (!imageUrl) {
    return null;
  }

  try {
    const result =
      await requestBuffer(
        imageUrl,
        {
          timeout:
            REQUEST_TIMEOUT
        }
      );

    if (
      !result.buffer ||
      !result.buffer.length
    ) {
      return null;
    }

    /*
     * 15 MB
     */
    if (
      result.buffer.length >
      15 * 1024 * 1024
    ) {
      return null;
    }

    return result.buffer;
  } catch (error) {
    console.log(
      '⚠️ دانلود تصویر ناموفق:',
      error.message
    );

    return null;
  }
}


/* ============================================================
 * Telegram parser
 * ============================================================
 */

async function fetchTelegramSource(
  source
) {
  const items = [];

  try {
    const html =
      await requestText(
        source.url,
        {
          timeout:
            REQUEST_TIMEOUT
        }
      );

    const $ =
      cheerio.load(html);

    $(
      '.tgme_widget_message_wrap'
    ).each(
      function () {
        if (
          items.length >=
          MAX_ITEMS_PER_SOURCE
        ) {
          return false;
        }

        const wrapper =
          $(this);

        const message =
          wrapper.find(
            '.tgme_widget_message'
          ).first();

        const text =
          cleanText(
            message.find(
              '.tgme_widget_message_text'
            ).text()
          );

        const title =
          extractTelegramTitle(
            text
          );

        if (!title) {
          return;
        }

        const date =
          extractTelegramDateFromElement(
            message
          );

        const messageLink =
          message.find(
            '.tgme_widget_message_date'
          ).attr('href') ||
          '';

        let imageUrl = '';

        const photo =
          message.find(
            '.tgme_widget_message_photo_wrap'
          ).first();

        if (
          photo.length
        ) {
          const style =
            photo.attr('style') ||
            '';

          const match =
            style.match(
              /url\(['"]?([^'")]+)['"]?\)/i
            );

          if (match) {
            imageUrl =
              match[1];
          }
        }

        /*
         * فقط تصویر خود پست را استخراج کن.
         * از img عمومی صفحه استفاده نمی‌کنیم، چون ممکن است
         * آواتار/تصویر کانال را برگرداند.
         */
        if (!imageUrl) {
          const mediaSelectors = [
            '.tgme_widget_message_photo_wrap',
            '.tgme_widget_message_photo',
            '.tgme_widget_message_video',
            '.tgme_widget_message_document'
          ];

          for (const selector of mediaSelectors) {
            const media = message.find(selector).first();

            if (!media.length) continue;

            const style = media.attr('style') || '';
            const styleMatch = style.match(
              /url\(['"]?([^'")]+)['"]?\)/i
            );

            if (styleMatch && styleMatch[1]) {
              imageUrl = styleMatch[1];
              break;
            }

            const mediaImage = media.find('img').first();

            if (mediaImage.length) {
              imageUrl =
                mediaImage.attr('src') ||
                mediaImage.attr('data-src') ||
                mediaImage.attr('data-lazy-src') ||
                '';

              if (imageUrl) break;
            }
          }
        }

        /*
         * برای ویدئو فقط thumbnail خود ویدئو را قبول کن.
         */
        if (!imageUrl) {
          const video = message.find(
            '.tgme_widget_message_video'
          ).first();

          if (video.length) {
            imageUrl =
              video.attr('data-thumb') ||
              video.attr('data-thumbnail') ||
              '';
          }
        }

        const id =
          extractTelegramMessageId(
            messageLink
          );

        items.push({
          id:
            id ||
            messageLink ||
            sha1(text),

          messageId:
            id,

          title:
            title,

          description:
            removeSourceNoise(
              text
            ),

          content:
            removeSourceNoise(
              text
            ),

          text:
            removeSourceNoise(
              text
            ),

          publishedAt:
            date,

          url:
            messageLink,

          imageUrl:
            imageUrl,

          source:
            source.name,

          sourceUrl:
            source.url
        });
      }
    );
  } catch (error) {
    console.log(
      '❌ Telegram ' +
      source.name +
      ': ' +
      error.message
    );
  }

  return items;
}


function extractTelegramDateFromElement(
  message
) {
  if (!message) {
    return null;
  }

  const values = [];

  message
    .find('time[datetime]')
    .each(
      function () {
        const value =
          message
            .find('time[datetime]')
            .first()
            .attr('datetime');

        if (value) {
          values.push(value);
        }
      }
    );

  for (
    let i = 0;
    i < values.length;
    i++
  ) {
    const date =
      parseDate(
        values[i]
      );

    if (date) {
      return date;
    }
  }

  return null;
}


function extractTelegramMessageId(
  url
) {
  if (!url) {
    return '';
  }

  const match =
    String(url).match(
      /\/(\d+)(?:\?|$)/
    );

  return match
    ? match[1]
    : '';
}


function extractTelegramTitle(
  text
) {
  if (!text) {
    return '';
  }

  const lines =
    text
      .split('\n')
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);

  if (!lines.length) {
    return '';
  }

  let title =
    lines[0];

  title =
    title
      .replace(/^📰\s*/u, '')
      .replace(/^🔴\s*/u, '')
      .replace(/^🟢\s*/u, '')
      .replace(/^🔵\s*/u, '')
      .replace(/^✅\s*/u, '')
      .replace(
        /^#هوراند\s*\|\s*/i,
        ''
      )
      .replace(
        /^#ورزقان\s*\|\s*/i,
        ''
      )
      .replace(
        /^#اهر\s*\|\s*/i,
        ''
      )
      .replace(
        /^#کلیبر\s*\|\s*/i,
        ''
      )
      .replace(
        /^#خداآفرین\s*\|\s*/i,
        ''
      )
      .trim();

  return removeSourceNoise(
    title
  );
}


/* ============================================================
 * RSS
 * ============================================================
 */

async function fetchRSSSource(
  source
) {
  try {
    console.log(
      '📡 RSS شروع: ' +
      (source.name || source.id || 'منبع') +
      ' | ' +
      source.url
    );

    const feed =
      await parser.parseURL(
        source.url
      );

    const feedItems = feed.items || [];

    console.log(
      '📥 RSS نتیجه: ' +
      feedItems.length +
      ' | ' +
      (source.name || source.id || 'منبع')
    );

    return feedItems
      .slice(
        0,
        MAX_ITEMS_PER_SOURCE
      )
      .map(function (entry) {
        const description =
          cleanText(
            firstNonEmpty(
              entry.contentSnippet,
              entry.content,
              entry.summary,
              entry.description
            )
          );

        return {
          id:
            firstNonEmpty(
              entry.guid,
              entry.id,
              entry.link,
              sha1(
                entry.title
              )
            ),

          title:
            cleanText(
              entry.title
            ),

          description:
            description,

          content:
            description,

          text:
            [
              entry.title,
              description
            ]
              .filter(Boolean)
              .join('\n'),

          publishedAt:
            getPublishedDate(
              entry
            ),

          url:
            firstNonEmpty(
              entry.link,
              entry.guid
            ),

          imageUrl:
            extractRSSImage(
              entry
            ),

          source:
            source.name,

          sourceUrl:
            source.url
        };
      });
  } catch (error) {
    console.log(
      '❌ RSS ' +
      source.name +
      ': ' +
      error.message
    );

    return [];
  }
}


function extractRSSImage(
  entry
) {
  if (!entry) {
    return '';
  }

  if (
    entry.enclosure &&
    entry.enclosure.url
  ) {
    const type =
      entry.enclosure.type ||
      '';

    if (
      /^image\//i.test(type) ||
      /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(
        entry.enclosure.url
      )
    ) {
      return entry.enclosure.url;
    }
  }

  if (
    entry['media:content'] &&
    entry['media:content'].$ &&
    entry['media:content'].$.url
  ) {
    return entry[
      'media:content'
    ].$.url;
  }

  if (
    entry.content
  ) {
    const match =
      String(entry.content).match(
        /<img[^>]+src=["']([^"']+)["']/i
      );

    if (match) {
      return match[1];
    }
  }

  return '';
}


/* ============================================================
 * HTML source
 * ============================================================
 */

async function fetchHTMLSource(
  source
) {
  const items = [];

  try {
    console.log(
      '🌐 HTML شروع: ' +
      (source.name || source.id || 'منبع') +
      ' | ' +
      source.url
    );

    const html =
      await requestText(
        source.url,
        {
          timeout:
            REQUEST_TIMEOUT
        }
      );

    const $ =
      cheerio.load(html);

    console.log(
      '📄 HTML دریافت شد: ' +
      html.length +
      ' بایت | ' +
      (source.name || source.id || 'منبع')
    );

    /*
     * لینک‌های خبر
     */
    const links = [];

    $('a[href]').each(
      function () {
        if (
          links.length >=
          MAX_ITEMS_PER_SOURCE
        ) {
          return false;
        }

        const a =
          $(this);

        const title =
          cleanText(
            a.text()
          );

        const href =
          a.attr('href') ||
          '';

        if (
          !title ||
          title.length < 15
        ) {
          return;
        }

        if (
          !href ||
          href === '#'
        ) {
          return;
        }

        let absolute;

        try {
          absolute =
            new URL(
              href,
              source.url
            ).toString();
        } catch (error) {
          return;
        }

        if (
          !/^https?:\/\//i.test(
            absolute
          )
        ) {
          return;
        }

        /*
         * لینک‌های غیرخبری
         */
        if (
          /javascript:|login|register|contact|search/i.test(
            absolute
          )
        ) {
          return;
        }

        links.push({
          title:
            title,
          url:
            absolute
        });
      }
    );

    console.log(
      '🔗 لینک‌های کاندید: ' +
      links.length +
      ' | ' +
      (source.name || source.id || 'منبع')
    );

    /*
     * حذف لینک‌های تکراری
     */
    const unique =
      [];

    const seen =
      new Set();

    links.forEach(
      function (item) {
        const key =
          item.url;

        if (
          seen.has(key)
        ) {
          return;
        }

        seen.add(key);
        unique.push(item);
      }
    );

    /*
     * صفحه هر خبر
     */
    for (
      let i = 0;
      i < unique.length &&
      items.length <
        MAX_ITEMS_PER_SOURCE;
      i++
    ) {
      const candidate =
        unique[i];

      try {
        const article =
          await fetchArticlePage(
            candidate.url,
            source,
            candidate.title
          );

        if (article) {
          items.push(
            article
          );
        }
      } catch (error) {
        console.log(
          '⚠️ مقاله ناموفق: ' +
          candidate.url
        );
      }
    }
  } catch (error) {
    console.log(
      '❌ HTML ' +
      source.name +
      ': ' +
      error.message
    );
  }

  return items;
}


/* ============================================================
 * دریافت صفحه مقاله
 * ============================================================
 */

async function fetchArticlePage(
  url,
  source,
  fallbackTitle
) {
  const html =
    await requestText(
      url,
      {
        timeout:
          REQUEST_TIMEOUT
      }
    );

  const $ =
    cheerio.load(html);

  /*
   * عنوان
   */
  const title =
    cleanText(
      firstNonEmpty(
        $('meta[property="og:title"]').attr('content'),
        $('meta[name="twitter:title"]').attr('content'),
        $('h1').first().text(),
        $('title').first().text(),
        fallbackTitle
      )
    );

  if (!title) {
    return null;
  }

  /*
   * توضیح
   */
  const description =
    cleanText(
      firstNonEmpty(
        $('meta[property="og:description"]').attr('content'),
        $('meta[name="description"]').attr('content')
      )
    );

  /*
   * تاریخ
   */
  let publishedAt =
    null;

  const dateCandidates = [
    $('meta[property="article:published_time"]').attr('content'),
    $('meta[name="date"]').attr('content'),
    $('time[datetime]').first().attr('datetime'),
    $('[datetime]').first().attr('datetime')
  ];

  for (
    let i = 0;
    i < dateCandidates.length;
    i++
  ) {
    const date =
      parseDate(
        dateCandidates[i]
      );

    if (date) {
      publishedAt =
        date;
      break;
    }
  }

  /*
   * متن مقاله
   */
  const articleSelectors = [
    'article',
    '.article-body',
    '.article-content',
    '.news-content',
    '.news-text',
    '.content',
    '.item-text',
    '.story'
  ];

  let content = '';

  for (
    let i = 0;
    i < articleSelectors.length;
    i++
  ) {
    const node =
      $(articleSelectors[i])
        .first();

    if (
      node.length
    ) {
      const text =
        cleanText(
          node.text()
        );

      if (
        text.length >
        content.length
      ) {
        content =
          text;
      }
    }
  }

  if (
    content.length < 50
  ) {
    content =
      description;
  }

  /*
   * تصویر
   */
  let imageUrl =
    firstNonEmpty(
      $('meta[property="og:image"]').attr('content'),
      $('meta[name="twitter:image"]').attr('content')
    );

  if (!imageUrl) {
    const img =
      $('article img')
        .first();

    if (
      img.length
    ) {
      imageUrl =
        firstNonEmpty(
          img.attr('src'),
          img.attr('data-src'),
          img.attr('data-lazy-src')
        );
    }
  }

  if (imageUrl) {
    try {
      imageUrl =
        new URL(
          imageUrl,
          url
        ).toString();
    } catch (error) {
      imageUrl = '';
    }
  }

  return {
    id:
      url,

    title:
      title,

    description:
      description,

    content:
      content,

    text:
      [
        title,
        content
      ]
        .filter(Boolean)
        .join('\n'),

    publishedAt:
      publishedAt,

    url:
      url,

    imageUrl:
      imageUrl,

    source:
      source.name,

    sourceUrl:
      source.url
  };
}


/* ============================================================
 * Google News
 * ============================================================
 */

async function fetchGoogleNewsSource(
  source
) {
  /*
   * Google News خروجی RSS است.
   * اما عنوان‌ها ممکن است به منابع خارجی یا ملی
   * اشاره کنند؛ بنابراین بعداً فیلتر محلی اعمال می‌شود.
   */
  return fetchRSSSource(
    source
  );
}


/* ============================================================
 * تشخیص نوع منبع
 * ============================================================
 */

async function fetchSource(
  source
) {
  if (!source) {
    return [];
  }

  console.log(
    '🔎 دریافت: ' +
    (source.name || source.id || 'منبع')
  );

  let items = [];

  try {
    const type =
      String(
        source.type || ''
      ).toLowerCase();

    /*
     * Google News
     */
    if (
      type === 'google-news' ||
      String(source.id || '')
        .startsWith('google-')
    ) {
      items =
        await fetchGoogleNewsSource(
          source
        );
    }

    /*
     * RSS
     */
    else if (
      type === 'rss'
    ) {
      items =
        await fetchRSSSource(
          source
        );
    }

    /*
     * Telegram
     */
    else if (
      type === 'telegram'
    ) {
      items =
        await fetchTelegramSource(
          source
        );
    }

    /*
     * HTML
     */
    else if (
      type === 'html'
    ) {
      items =
        await fetchHTMLSource(
          source
        );
    }

    else {
      console.log(
        '⚠️ نوع منبع پشتیبانی نمی‌شود: ' +
        type
      );
    }
  } catch (error) {
    console.log(
      '❌ خطا در دریافت ' +
      source.name +
      ': ' +
      error.message
    );
  }

  console.log(
    '   📥 ' +
    items.length +
    ' خبر خام'
  );

  return items;
}


/* ============================================================
 * Hash خبر
 * ============================================================
 */

function createNewsHash(
  item
) {
  const title =
    normalizeForCompare(
      item && item.title
    );

  const body =
    normalizeForCompare(
      item &&
      firstNonEmpty(
        item.content,
        item.description,
        item.text
      )
    ).slice(
      0,
      1200
    );

  const location =
    normalizeForCompare(
      detectLocation(item)
    );

  const url =
    firstNonEmpty(
      item && item.url,
      item && item.link,
      ''
    );

  return sha1(
    [
      title,
      body,
      location,
      url
    ].join('|')
  );
}


/* ============================================================
 * نرمال‌سازی خبر
 * ============================================================
 */

function normalizeItem(
  raw,
  source
) {
  if (!raw) {
    return null;
  }

  const item =
    Object.assign(
      {},
      raw
    );

  item.source =
    firstNonEmpty(
      raw.source,
      source && source.name,
      'منبع نامشخص'
    );

  item.sourceName =
    item.source;

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
    getTitle(
      raw
    );

  item.content =
    removeTitleFromBody(
      item.title,
      getArticleText(raw)
    );

  item.description =
    item.content;

  item.text =
    [
      item.title,
      item.content
    ]
      .filter(Boolean)
      .join('\n');

  item.publishedDate =
    getPublishedDate(
      raw
    );

  item.publishedAt =
    item.publishedDate
      ? item.publishedDate.toISOString()
      : null;

  item.publishedAtFormatted =
    item.publishedDate
      ? formatPersianDate(
          item.publishedDate
        )
      : '';

  item.imageUrl =
    extractImageUrl(
      raw
    );

  item.imageBuffer =
    null;

  item.location =
    detectLocation(
      item
    );

  item.hash =
    createNewsHash(
      item
    );

  item.id =
    firstNonEmpty(
      raw.id,
      raw.messageId,
      item.url,
      item.hash
    );

  return item;
}


/* ============================================================
 * شباهت
 * ============================================================
 */

function similarityScore(
  a,
  b
) {
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
      aa.split(' ')
        .filter(Boolean)
    );

  const wordsB =
    new Set(
      bb.split(' ')
        .filter(Boolean)
    );

  let common = 0;

  wordsA.forEach(
    function (word) {
      if (
        wordsB.has(word)
      ) {
        common++;
      }
    }
  );

  const union =
    new Set(
      Array.from(wordsA)
        .concat(
          Array.from(wordsB)
        )
    ).size;

  return union
    ? common / union
    : 0;
}


function isDuplicateNews(
  item,
  accepted
) {
  if (
    !item ||
    !Array.isArray(accepted)
  ) {
    return false;
  }

  const hash =
    item.hash ||
    createNewsHash(item);

  for (
    let i = 0;
    i < accepted.length;
    i++
  ) {
    const old =
      accepted[i];

    if (!old) {
      continue;
    }

    const oldHash =
      old.hash ||
      createNewsHash(old);

    if (
      hash &&
      oldHash &&
      hash === oldHash
    ) {
      return true;
    }

    /*
     * عنوان تقریباً یکسان
     */
    if (
      similarityScore(
        item.title,
        old.title
      ) >= 0.84
    ) {
      return true;
    }

    /*
     * متن تقریباً یکسان
     */
    if (
      similarityScore(
        item.content,
        old.content
      ) >= 0.92
    ) {
      return true;
    }
  }

  return false;
}


/* ============================================================
 * اعتبارسنجی
 * ============================================================
 */

function validateNews(
  item
) {
  const errors = [];

  if (!item) {
    errors.push(
      'خبر خالی است'
    );

    return {
      valid: false,
      errors
    };
  }

  if (
    !item.title ||
    item.title.length < 12
  ) {
    errors.push(
      'عنوان نامعتبر'
    );
  }

  if (
    isIncompleteNews(item)
  ) {
    errors.push(
      'خبر ناقص یا نامعتبر'
    );
  }

  if (
    REQUIRE_NEWS_DATE &&
    !item.publishedDate
  ) {
    errors.push(
      'تاریخ مشخص نیست'
    );
  }

  if (
    hasBlockedContent(item)
  ) {
    errors.push(
      'محتوای غیرخبری'
    );
  }

  return {
    valid:
      errors.length === 0,
    errors
  };
}


/* ============================================================
 * فیلتر اصلی
 * ============================================================
 */

function filterNews(
  items,
  options
) {
  options =
    options || {};

  const result = [];

  const stats = {
    input:
      Array.isArray(items)
        ? items.length
        : 0,

    invalid: 0,
    blocked: 0,
    old: 0,
    nonLocal: 0,
    foreign: 0,
    duplicate: 0,
    accepted: 0
  };

  if (
    !Array.isArray(items)
  ) {
    return {
      items: [],
      stats
    };
  }

  const maxAge =
    Number(
      options.maxAgeHours ||
      NEWS_MAX_AGE_HOURS
    );

  const requireLocal =
    options.requireLocal !== false;

  for (
    let i = 0;
    i < items.length;
    i++
  ) {
    const item =
      normalizeItem(
        items[i],
        options.source
      );

    if (!item) {
      stats.invalid++;
      continue;
    }

    const validation =
      validateNews(item);

    if (
      !validation.valid
    ) {
      if (
        hasBlockedContent(item)
      ) {
        stats.blocked++;
      } else {
        stats.invalid++;
      }

      continue;
    }

    /*
     * تاریخ
     */
    if (
      !item.publishedDate
    ) {
      if (
        REQUIRE_NEWS_DATE
      ) {
        stats.old++;
        continue;
      }
    } else if (
      !isRecentNews(
        item,
        maxAge
      )
    ) {
      stats.old++;
      continue;
    }

    /*
     * خبر خارجی
     */
    if (
      isForeignNews(item)
    ) {
      stats.foreign++;
      continue;
    }

    /*
     * خبر محلی
     */
    if (
      requireLocal &&
      !isLocalNews(item)
    ) {
      stats.nonLocal++;
      continue;
    }

    /*
     * تکراری
     */
    if (
      isDuplicateNews(
        item,
        result
      )
    ) {
      stats.duplicate++;
      continue;
    }

    result.push(item);

    stats.accepted++;

    if (
      result.length >=
      Number(
        options.limit ||
        MAX_TOTAL_ITEMS
      )
    ) {
      break;
    }
  }

  /*
   * جدیدترین اول
   */
  result.sort(
    function (a, b) {
      const ta =
        a.publishedDate
          ? a.publishedDate.getTime()
          : 0;

      const tb =
        b.publishedDate
          ? b.publishedDate.getTime()
          : 0;

      return tb - ta;
    }
  );

  return {
    items: result,
    stats
  };
}


/* ============================================================
 * History
 * ============================================================
 */

function filterAgainstHistory(
  items,
  history
) {
  if (
    !Array.isArray(items)
  ) {
    return [];
  }

  if (
    !Array.isArray(history)
  ) {
    return items;
  }

  const hashes =
    new Set();

  const urls =
    new Set();

  history.forEach(
    function (entry) {
      if (!entry) {
        return;
      }

      if (entry.hash) {
        hashes.add(
          String(entry.hash)
        );
      }

      if (entry.url) {
        urls.add(
          String(entry.url)
        );
      }

      if (entry.link) {
        urls.add(
          String(entry.link)
        );
      }

      if (entry.id) {
        hashes.add(
          String(entry.id)
        );
      }
    }
  );

  return items.filter(
    function (item) {
      const hash =
        item.hash ||
        createNewsHash(item);

      if (
        hash &&
        hashes.has(
          String(hash)
        )
      ) {
        return false;
      }

      if (
        item.url &&
        urls.has(
          String(item.url)
        )
      ) {
        return false;
      }

      return true;
    }
  );
}


/* ============================================================
 * آماده‌سازی خبر
 * ============================================================
 */

async function prepareNewsForTelegram(
  item
) {
  if (!item) {
    return null;
  }

  if (
    item.imageUrl &&
    !item.imageBuffer
  ) {
    item.imageBuffer =
      await downloadImage(
        item.imageUrl
      );
  }

  return item;
}


/* ============================================================
 * متن نهایی
 * ============================================================
 */

function truncateText(
  text,
  maxLength
) {
  const value =
    String(text || '')
      .trim();

  if (
    value.length <=
    maxLength
  ) {
    return value;
  }

  let result =
    value.slice(
      0,
      maxLength
    );

  const lastSpace =
    result.lastIndexOf(' ');

  if (
    lastSpace >
    maxLength * 0.75
  ) {
    result =
      result.slice(
        0,
        lastSpace
      );
  }

  return (
    result.trim() +
    '…'
  );
}


function splitNewsSentences(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .split(/(?<=[.!؟؛])\s+|\n+/)
    .map(function (s) {
      return s
        .replace(/^[-•▪️🔹📰]+\s*/u, '')
        .trim();
    })
    .filter(function (s) {
      return s.length >= 18;
    });
}

function removeAttributionNoise(sentence) {
  return String(sentence || '')
    .replace(/^به گزارش(?: خبرنگار)?\s+/i, '')
    .replace(/^بر اساس گزارش(?: خبرنگار)?\s+/i, '')
    .replace(/^در گفت‌وگو با[^،:؛]+[،:؛]\s*/i, '')
    .replace(/^به گفته[^،:؛]+[،:؛]\s*/i, '')
    .replace(/^وی در ادامه افزود[،:؛]?\s*/i, '')
    .replace(/^این مسئول گفت[،:؛]?\s*/i, '')
    .replace(/^این مقام مسئول گفت[،:؛]?\s*/i, '')
    .replace(/^همچنین اعلام شد که\s+/i, '')
    .replace(/^همچنین اعلام کرد که\s+/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function rewriteSentenceStructure(sentence, index) {
  let s = removeAttributionNoise(sentence);

  s = s
    .replace(/اعلام کرد(?: که)?/g, 'از اعلامِ')
    .replace(/اعلام کردند(?: که)?/g, 'از اعلامِ')
    .replace(/اظهار داشت(?: که)?/g, 'از توضیحات')
    .replace(/اظهار داشتند(?: که)?/g, 'از توضیحات')
    .replace(/خبر داد(?: که)?/g, 'از این خبر حکایت دارد که')
    .replace(/در پی/g, 'پس از')
    .replace(/طی امروز/g, 'امروز')
    .replace(/در روز جاری/g, 'امروز')
    .replace(/صبح امروز/g, 'امروز صبح')
    .replace(/عصر امروز/g, 'امروز عصر')
    .replace(/به منظور/g, 'برای')
    .replace(/در راستای/g, 'با هدف')
    .replace(/صورت گرفت/g, 'انجام شد')
    .replace(/انجام گرفت/g, 'انجام شد')
    .replace(/مورد بررسی قرار گرفت/g, 'بررسی شد')
    .replace(/مورد بهره‌برداری قرار گرفت/g, 'به بهره‌برداری رسید')
    .replace(/مورد بهره برداری قرار گرفت/g, 'به بهره‌برداری رسید')
    .replace(/خواهد بود/g, 'است')
    .replace(/می‌باشد/g, 'است')
    .replace(/می باشد/g, 'است');

  if (index > 0) {
    s = s
      .replace(/^اما\s+/i, 'با این حال، ')
      .replace(/^همچنین\s+/i, 'در ادامه، ')
      .replace(/^بنابراین\s+/i, 'در نتیجه، ');
  }

  return s
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function deduplicateSentences(sentences) {
  const out = [];
  sentences.forEach(function (sentence) {
    const normalized = normalizeForCompare(sentence);
    if (!normalized) return;

    const repeated = out.some(function (existing) {
      const score = similarityScore(existing, sentence);
      return score >= 0.68 ||
        normalizeForCompare(existing) === normalized;
    });

    if (!repeated) out.push(sentence);
  });
  return out;
}

function reorderNewsSentences(sentences) {
  if (sentences.length <= 2) return sentences;

  const importance = function (s) {
    let score = 0;
    if (/ورزقان|خاروانا|دیزمار|جوشین|سیه.?رود/.test(s)) score += 5;
    if (/افتتاح|بهره.?برداری|انتصاب|تصمیم|مصوبه|آغاز|توقف|قطعی|حادثه|تصادف|واژگونی|آتش|بارش|برف|زلزله|سیل/.test(s)) score += 4;
    if (/عدد|درصد|کیلومتر|میلیارد|میلیون|نفر|روستا|مدرسه|پروژه/.test(s)) score += 2;
    if (/گفت|اظهار|توضیح|اعلام/.test(s)) score -= 1;
    return score;
  };

  return sentences
    .map(function (sentence, index) {
      return { sentence, index, score: importance(sentence) };
    })
    .sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map(function (x) { return x.sentence; });
}

function rewriteNewsText(text) {
  let value = removeSourceNoise(cleanText(text))
    .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/(?:^|\s)@[A-Za-z0-9_]{4,64}\b/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (!value) return '';

  const originalSentences = splitNewsSentences(value);
  let sentences = originalSentences
    .map(rewriteSentenceStructure)
    .filter(Boolean);

  sentences = deduplicateSentences(sentences);
  sentences = reorderNewsSentences(sentences);

  // متن نهایی نباید شبیه یک کپی خط‌به‌خط از منبع باشد.
  // اطلاعات حفظ می‌شود، اما ترتیب، اتصال و ساختار جمله‌ها تغییر می‌کند.
  if (sentences.length >= 2) {
    const lead = sentences[0].replace(/[؛:]?$/, '؛');
    const details = sentences.slice(1).map(function (s, i) {
      if (i === 0) return 'در جزئیات این خبر، ' + s.charAt(0).toLowerCase() + s.slice(1);
      return s;
    });
    value = [lead].concat(details).join(' ');
  } else {
    value = sentences.join(' ');
  }

  return value
    .replace(/\s+؛/g, '؛')
    .replace(/؛\s*؛/g, '؛')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}


function buildNewsText(
  item,
  options
) {
  options =
    options || {};

  if (!item) {
    return '';
  }

  const originalTitle = getTitle(item);
  let title = generateNewHeadline(
    originalTitle,
    getArticleText(item)
  );

  let body =
    removeTitleFromBody(
      title,
      getArticleText(item)
    );

  /*
   * ابتدا لینک‌ها، آیدی‌ها و امضاهای منبع حذف،
   * سپس متن بازنویسی می‌شود.
   */
  body =
    rewriteNewsText(
      body
    );

  /*
   * جلوگیری از انتشار مستقیم متن طولانی منبع.
   */
  body =
    truncateText(
      body,
      Number(
        options.maxBodyLength ||
        1200
      )
    );

  /*
   * اگر عنوان و متن بیش از حد شبیه باشند،
   * عنوان به شکل خبری کوتاه‌تر می‌شود.
   */
  if (
    title &&
    body &&
    similarityScore(title, body) > 0.72
  ) {
    body =
      removeTitleFromBody(
        title,
        body
      );
  }

  const parts = [];

  if (title) {
    parts.push(
      '📰 ' + title
    );
  }

  if (body) {
    parts.push(
      '🔹 ' + body
    );
  }

  if (
    item.publishedDate
  ) {
    parts.push(
      '🕐 ' +
      formatPersianDate(
        item.publishedDate
      )
    );
  }

  /*
   * نام منبع عمداً نمایش داده نمی‌شود.
   * لینک خبر اصلی نیز عمداً نمایش داده نمی‌شود.
   */

  /*
   * فقط هویت ورزقان مدیا در انتهای خبر.
   */
  if (
    options.appendChannel !== false
  ) {
    const channel =
      process.env.NEWS_CHANNEL_USERNAME ||
      '@varzqannews';

    parts.push(
      '📣 ورزقان مدیا'
    );

    if (channel) {
      parts.push(
        channel
      );
    }
  }

  return parts
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function formatNews(
  item,
  options
) {
  return buildNewsText(
    item,
    options
  );
}


/* ============================================================
 * پردازش نهایی
 * ============================================================
 */

function processNews(
  rawItems,
  options
) {
  options =
    options || {};

  const filtered =
    filterNews(
      rawItems,
      options
    );

  let finalItems =
    filtered.items;

  if (
    Array.isArray(
      options.history
    )
  ) {
    finalItems =
      filterAgainstHistory(
        finalItems,
        options.history
      );
  }

  return {
    items:
      finalItems,
    stats:
      filtered.stats
  };
}


/* ============================================================
 * اولویت منابع
 * ============================================================
 */

function sourcePriority(
  sourceName
) {
  const name =
    normalizePersian(
      sourceName
    );

  if (
    name.includes(
      'فرمانداری'
    )
  ) {
    return 100;
  }

  if (
    name.includes(
      'هوراند خبر'
    )
  ) {
    return 95;
  }

  if (
    name.includes(
      'ورزقان'
    )
  ) {
    return 94;
  }

  if (
    name.includes(
      'اهر خبر'
    )
  ) {
    return 93;
  }

  if (
    name.includes(
      'کلیبر'
    )
  ) {
    return 92;
  }

  if (
    name.includes(
      'تسنیم'
    )
  ) {
    return 85;
  }

  if (
    name.includes(
      'ایرنا'
    )
  ) {
    return 85;
  }

  if (
    name.includes(
      'ایسنا'
    )
  ) {
    return 85;
  }

  return 50;
}


function sortNews(
  items
) {
  return items
    .slice()
    .sort(
      function (a, b) {
        const pa =
          sourcePriority(
            a.source
          );

        const pb =
          sourcePriority(
            b.source
          );

        /*
         * ابتدا تاریخ مهم‌تر است.
         */
        const ta =
          a.publishedDate
            ? a.publishedDate.getTime()
            : 0;

        const tb =
          b.publishedDate
            ? b.publishedDate.getTime()
            : 0;

        if (ta !== tb) {
          return tb - ta;
        }

        return pb - pa;
      }
    );
}


/* ============================================================
 * دریافت همه منابع
 * ============================================================
 */

async function fetchAllNews(
  sources,
  options
) {
  options =
    options || {};

  const sourceList =
    Array.isArray(sources)
      ? sources
      : [];

  const allItems = [];

  console.log('');
  console.log(
    '📡 منابع فعال: ' +
    sourceList.length
  );
  console.log('');

  /*
   * منابع را یکی‌یکی دریافت می‌کنیم
   * تا فشار زیادی به سایت‌ها وارد نشود.
   */
  for (
    let i = 0;
    i < sourceList.length;
    i++
  ) {
    const source =
      sourceList[i];

    if (
      !source ||
      source.enabled === false
    ) {
      continue;
    }

    const items =
      await fetchSource(
        source
      );

    allItems.push(
      ...items
    );

    /*
     * فاصله کوتاه بین منابع
     */
    if (
      i <
      sourceList.length - 1
    ) {
      await sleep(150);
    }
  }

  console.log('');
  console.log(
    '📦 خام: ' +
    allItems.length
  );

  /*
   * ابتدا نرمال‌سازی
   */
  const normalized =
    allItems
      .map(
        function (item) {
          return normalizeItem(
            item,
            {
              name:
                item.source,
              url:
                item.sourceUrl
            }
          );
        }
      )
      .filter(Boolean);

  /*
   * حذف تکراری اولیه
   */
  const unique = [];

  for (
    let i = 0;
    i < normalized.length;
    i++
  ) {
    if (
      !isDuplicateNews(
        normalized[i],
        unique
      )
    ) {
      unique.push(
        normalized[i]
      );
    }
  }

  console.log(
    '♻️ بدون تکرار: ' +
    unique.length
  );

  /*
   * تاریخ
   */
  const recent =
    unique.filter(
      function (item) {
        if (
          !item.publishedDate
        ) {
          return !REQUIRE_NEWS_DATE;
        }

        return isRecentNews(
          item,
          NEWS_MAX_AGE_HOURS
        );
      }
    );

  console.log(
    '⏱️ کمتر از ' +
    NEWS_MAX_AGE_HOURS +
    ' ساعت: ' +
    recent.length
  );

  /*
   * محلی
   */
  const local =
    recent.filter(
      function (item) {
        return isLocalNews(
          item
        );
      }
    );

  console.log(
    '📍 محلی: ' +
    local.length
  );

  /*
   * فیلتر نهایی
   */
  const finalItems =
    local
      .filter(
        function (item) {
          return !isForeignNews(
            item
          );
        }
      )
      .filter(
        function (item) {
          return !hasBlockedContent(
            item
          );
        }
      );

  console.log(
    '🌍 نهایی: ' +
    finalItems.length
  );

  /*
   * مرتب‌سازی
   */
  const sorted =
    sortNews(
      finalItems
    );

  /*
   * محدودیت کل
   */
  return sorted.slice(
    0,
    Number(
      options.maxTotal ||
      MAX_TOTAL_ITEMS
    )
  );
}


/* ============================================================
 * Sleep
 * ============================================================
 */

function sleep(
  ms
) {
  return new Promise(
    function (resolve) {
      setTimeout(
        resolve,
        ms
      );
    }
  );
}


/* ============================================================
 * خلاصه خبر
 * ============================================================
 */

function getNewsSummary(
  item
) {
  if (!item) {
    return null;
  }

  return {
    title:
      item.title || '',

    source:
      item.source || '',

    location:
      detectLocation(item),

    publishedAt:
      item.publishedAt || null,

    publishedAtFormatted:
      item.publishedAtFormatted || '',

    image:
      Boolean(
        item.imageUrl
      ),

    url:
      item.url || '',

    hash:
      item.hash || ''
  };
}


/* ============================================================
 * شناسه
 * ============================================================
 */

function getNewsId(
  item
) {
  if (!item) {
    return '';
  }

  return (
    item.hash ||
    createNewsHash(item) ||
    item.url ||
    ''
  );
}


/* ============================================================
 * سازگاری با نسخه‌های قبلی
 * ============================================================
 */

function cleanNews(
  item,
  source
) {
  return normalizeItem(
    item,
    source
  );
}


function isValidNews(
  item
) {
  return validateNews(
    item
  ).valid;
}


function isOldNews(
  item,
  hours
) {
  if (
    !item ||
    !item.publishedDate
  ) {
    return false;
  }

  return !isRecentNews(
    item,
    hours ||
      NEWS_MAX_AGE_HOURS
  );
}


/* ============================================================
 * Export
 * ============================================================
 */

module.exports = {
  /* دریافت */
  fetchAllNews,
  fetchSource,
  fetchRSSSource,
  fetchGoogleNewsSource,
  fetchTelegramSource,
  fetchHTMLSource,
  fetchArticlePage,

  /* پردازش */
  processNews,
  filterNews,
  filterAgainstHistory,
  normalizeItem,
  cleanNews,

  /* فیلتر محلی */
  isLocalNews,
  isVarzqanRelevant,
  isHorandRelevant,
  isAharRelevant,
  isKaleybarRelevant,
  isKhodaAfarinRelevant,
  isForeignNews,
  hasBlockedContent,
  isIncompleteNews,

  /* تاریخ */
  parseDate,
  getPublishedDate,
  isRecentNews,
  isOldNews,
  formatPersianDate,
  toPersianDigits,

  /* متن */
  cleanText,
  normalizePersian,
  normalizeForCompare,
  removeUrls,
  removeChannelSignatures,
  removeSourceNoise,
  getTitle,
  getArticleText,
  removeTitleFromBody,
  buildNewsText,
  formatNews,

  /* تصویر */
  extractImageUrl,
  downloadImage,
  prepareNewsForTelegram,

  /* تکراری */
  createNewsHash,
  similarityScore,
  isDuplicateNews,

  /* سایر */
  validateNews,
  isValidNews,
  detectLocation,
  getNewsId,
  getNewsSummary
};
