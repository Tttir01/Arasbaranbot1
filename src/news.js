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

    if (      /telegram\.me/i.test(line)
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
  'رئیس جدید',  'رییس جدید',

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

  // وجود نام ورزقان/خاروانا باعث می‌شود نشانه‌های عمومی خارجی
  // به‌تنهایی خبر را حذف نکنند؛ اما خبر باید از فیلتر محلی نیز عبور کند.
  const hasTargetArea = containsAny(
    text,
    [].concat(LOCAL_AREAS.varzqan, LOCAL_AREAS.kharvana)
  );

  if (hasTargetArea) return false;

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

  if (containsAny(text, LOCAL_AREAS.kharvana)) return 'خاروانا';
  if (containsAny(text, LOCAL_AREAS.varzqan)) return 'ورزقان';
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
  const text =    getNewsSearchText(item);

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
  if (!item || hasBlockedContent(item)) return false;

  const text = getNewsSearchText(item);

  // فقط دو حوزه هدف: ورزقان و خاروانا.
  // نام «ارسباران»، «آذربایجان شرقی» یا شهرستان‌های دیگر به‌تنهایی کافی نیست.
  const hasTargetArea = containsAny(
    text,
    [].concat(LOCAL_AREAS.varzqan, LOCAL_AREAS.kharvana)
  );

  if (!hasTargetArea) return false;

  // خبرهای خارجی فقط وقتی پذیرفته می‌شوند که محتوای محلی هدف نیز داشته باشند.
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
   * فقط datetime واقعی پیام Telegram   */
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
    hasBlockedContent(item)  ) {
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

        if (!imageUrl) {
          const img =
            message.find(
              'img'
            ).first();

          if (img.length) {
            imageUrl =
              img.attr('src') ||
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
            .first()            .attr('datetime');

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