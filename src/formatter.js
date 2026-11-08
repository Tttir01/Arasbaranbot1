'use strict';

// مقصد انتشار از همان متغیر محیطی ربات خوانده می‌شود؛ مقدار پیش‌فرض کانال ورزقان مدیا است.
const CHANNEL_ID = String(process.env.TELEGRAM_CHANNEL_ID || '@varzqannews').trim();

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

function stripChannelPromo(value) {
  return String(value || '')
    // امضای تبلیغاتی کانال‌های تلگرامی
    .replace(/#?\s*دیزمار\s*؛?[^|]*?(?:اینستاگرام|تلگرام)?[^\n]*$/gim, ' ')
    .replace(/مرجع اخبار منطقه[^\n]*$/gim, ' ')
    .replace(/اخبار داغ آذربایجان[^\n]*$/gim, ' ')
    .replace(/دنبال کنید[^\n]*$/gim, ' ')
    .replace(/اینستاگرام\s*\|\s*تلگرام/gim, ' ')
    .replace(/[🔗📡🌐👇🧨\s]+$/g, ' ')
    .trim();
}

function cleanText(text) {
  return stripChannelPromo(String(text || ''))
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/www\.\S+/gi, '')
    .replace(/instagram\.com\/\S+/gi, '')
    .replace(/t\.me\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(title) {
  return cleanText(title)
    .replace(
      /\s*[-|]\s*(تسنیم|ایرنا|ایسنا|فارس|مهر)\s*$/i,
      ''
    )
    .trim();
}

function isGenericTitle(title) {
  const value = cleanTitle(title);
  if (!value || value.length < 18) return true;
  return /^(آذربایجان شرقی|اخبار آذربایجان شرقی|وزارت آموزش و پرورش|آموزش و پرورش|خبر جدید|اخبار|اخبار روز)(\\s*[-|:：].*)?$/i.test(value);
}

function titleFromDescription(description) {
  const value = cleanText(description);
  if (!value || value.length < 45) return '';
  const firstSentence = value.split(/(?<=[.!؟])\\s+/)[0] || value;
  const title = firstSentence.length > 110
    ? firstSentence.slice(0, 107).replace(/\\s+\\S*$/, '') + '…'
    : firstSentence;
  return cleanTitle(title);
}

function formatPersianDate(
  date,
  timezone
) {
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

function formatPersianTime(
  date,
  timezone
) {
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
  const name =
    cleanText(sourceName);

  if (!name) return '';

  if (
    /^google news/i.test(name)
  ) {
    return '';
  }

  // نام منبع در متن پست منتشر نمی‌شود.
  // منبع فقط در لاگ اجرا و تاریخچه اخبار (data/news-history.json) نگه داشته می‌شود.
  return '';
}

function makeSummary(
  text,
  maxLength
) {
  let value =
    cleanText(text);

  value = value
    .replace(
      /^به گزارش[^:：]*[:：]\s*/i,
      ''
    )
    .replace(
      /^طبق گزارش[^:：]*[:：]\s*/i,
      ''
    )
    .replace(
      /^به نقل از[^:：]*[:：]\s*/i,
      ''
    )
    .trim();

  if (!value) return '';

  if (
    value.length <= maxLength
  ) {
    return value;
  }

  let cut =
    value.substring(
      0,
      maxLength
    );

  const lastSpace =
    cut.lastIndexOf(' ');

  if (
    lastSpace >
    maxLength * 0.75
  ) {
    cut =
      cut.substring(
        0,
        lastSpace
      );
  }

  return `${cut}…`;
}

function normalizeForSimilarity(text) {
  return cleanText(text)
    .replace(/[\u200c\u200f\u200e]/g, '')
    .replace(/[^\u0600-\u06FF\u0030-\u0039a-zA-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function similarityRatio(a, b) {
  const aa = normalizeForSimilarity(a);
  const bb = normalizeForSimilarity(b);
  if (!aa || !bb) return 0;
  const aWords = new Set(aa.split(' ').filter(w => w.length > 2));
  const bWords = new Set(bb.split(' ').filter(w => w.length > 2));
  if (!aWords.size || !bWords.size) return 0;
  let common = 0;
  for (const word of aWords) {
    if (bWords.has(word)) common++;
  }
  return common / Math.max(aWords.size, bWords.size);
}


async function formatNews(
  item,
  options = {}
) {
  const timezone =
    options.timezone ||
    'Asia/Tehran';

  const forPhoto =
    options.forPhoto !== false &&
    !!item.imageUrl;

  let title = lightEdit(cleanTitle(item.title));

  let description = lightEdit(
    makeSummary(
      item.description || item.content || item.summary || item.text,
      10000
    )
  );

  // اگر RSS به‌جای تیتر خبر، فقط نام استان/ناشر را داده باشد،
  // از متن واقعی خبر تیتر می‌سازیم؛ اگر متن کافی نیست، خبر را منتشر نمی‌کنیم.
  if (isGenericTitle(title)) {
    title = titleFromDescription(description);
  }

  if (isGenericTitle(title) || !description || description.length < 35) {
    console.log('⛔ خبر به‌دلیل تیتر یا متن ناکافی منتشر نشد: ' + (item.title || 'بدون عنوان'));
    return '';
  }

  let finalTitle = title;

  // حالت رایگان: فقط ویرایش و پاک‌سازی محلی؛ هیچ API پولی فراخوانی نمی‌شود.

  // در خبرهای کانال تلگرامی، کل متن داخل تیتر است:
  // جمله اول تیتر می‌شود و بقیه به متن خبر می‌رود (بدون تکرار).
  const splitTitleBodyResult = splitTitleBody(finalTitle, description);
  finalTitle = splitTitleBodyResult.title;
  description = splitTitleBodyResult.body;

  finalTitle = shortenTitle(finalTitle);

  // تیتر و جمله‌های تکراری داخل متن پست حذف می‌شوند
  description = dedupeAgainstTitle(description, finalTitle);

  const source = sourceLabel(item.publisherName || item.source || item.sourceName);
  const sourceUrl = /^https?:\/\//i.test(String(item.url || ''))
    ? String(item.url).trim()
    : '';

  let publishedAt = null;

  if (item.publishedAt) {
    const date =
      new Date(
        item.publishedAt
      );

    if (!isNaN(date.getTime())) {
      publishedAt = date;
    }
  }

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

  const parts = [
    `📰 ${finalTitle}`
  ];

  if (source) {
    parts.push(source);
  }

  if (description) {
    parts.push(description);
  }

  if (sourceUrl) {
    parts.push(`🔗 منبع: ${sourceUrl}`);
  }

  parts.push(
    `🕐 ${date} - ${time}`
  );


  parts.push(
    CHANNEL_ID
  );

  let text =
    parts.join('\n\n').trim();

  return text;
}

module.exports = {
  formatNews,
  formatPersianDate,
  formatPersianTime,
  toPersianDigits
};


/* ============================================================
 * حذف تکرار تیتر و جمله‌های تکراری از متن پست
 * ============================================================
 */

function similarityRatio(a, b) {
  const wordsA = new Set(String(a || '').split(' ').filter(Boolean));
  const wordsB = new Set(String(b || '').split(' ').filter(Boolean));

  if (!wordsA.size || !wordsB.size) return 0;

  let common = 0;
  wordsA.forEach(word => {
    if (wordsB.has(word)) common++;
  });

  const union = new Set([...wordsA, ...wordsB]).size;
  return union ? common / union : 0;
}

function dedupeAgainstTitle(text, title) {
  const value = String(text || '').trim();
  if (!value) return '';

  const titleKey = normalizeForSimilarity(title);
  const sentences = value
    .split(/(?<=[.!؟…])\s+|\n+/)
    .map(part => part.trim())
    .filter(Boolean);

  const kept = [];
  const seen = [];

  // اگر کل متن، همان تیتر است، متن تکرار نشود
  const wholeKey = normalizeForSimilarity(value);
  if (titleKey && wholeKey && (titleKey.includes(wholeKey) || wholeKey.includes(titleKey))) {
    return '';
  }

  for (const sentence of sentences) {
    const key = normalizeForSimilarity(sentence);
    if (!key) continue;

    // جمله‌ای که داخل تیتر آمده یا تیتر داخل آن آمده
    if (titleKey && key.length > 20 && (titleKey.includes(key) || key.includes(titleKey))) {
      continue;
    }

    // جمله‌ای که خودِ تیتر را دوباره می‌گوید
    if (titleKey && (key === titleKey || (key.includes(titleKey) && key.length <= titleKey.length * 1.4))) {
      continue;
    }

    // جمله اول اگر تقریباً همان تیتر باشد
    if (titleKey && kept.length === 0 && similarityRatio(key, titleKey) >= 0.8) {
      continue;
    }

    // جمله تکراری داخل خود متن
    if (seen.some(previous => previous === key || similarityRatio(previous, key) >= 0.85)) {
      continue;
    }

    seen.push(key);
    kept.push(sentence);
  }

  return kept.join(' ').trim();
}


/* ============================================================
 * کوتاه کردن تیترهای تلگرامی که کل متن خبر را در خود دارند
 * ============================================================
 */

function shortenTitle(title) {
  const value = cleanText(title);
  if (!value) return '';

  const firstSentence = value.split(/(?<=[.!؟…])\s+/)[0] || value;
  const candidate = firstSentence.length > 25 ? firstSentence : value;

  if (candidate.length <= 120) return candidate.trim();

  const cut = candidate.slice(0, 117);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 90 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}


/* ============================================================
 * جدا کردن تیتر و متن وقتی هر دو یک چیز هستند
 * ============================================================
 */

function splitTitleBody(title, description) {
  const head = String(title || '').trim();
  const body = String(description || '').trim();

  const headKey = normalizeForSimilarity(head);
  const bodyKey = normalizeForSimilarity(body);

  if (!headKey || !bodyKey) return { title: head, body };

  const identical =
    headKey === bodyKey ||
    headKey.includes(bodyKey) ||
    bodyKey.includes(headKey);

  if (!identical) return { title: head, body };

  // جداکننده‌های رایج کانال‌های تلگرامی: ▫️ ▪️ —
  const bulletSplit = head.split(/\s(?=[▫▪•])/).map(part => part.trim()).filter(Boolean);
  const sentences = (bulletSplit.length > 1 ? bulletSplit : head.split(/(?<=[.!؟…])\s+/))
    .map(part => part.trim())
    .filter(Boolean);

  if (sentences.length < 2) return { title: head, body: '' };

  let newTitle = sentences[0];
  if (newTitle.length > 120) {
    newTitle = newTitle.slice(0, 117).replace(/\s+\S*$/, '') + '…';
  }

  return {
    title: newTitle,
    body: sentences.slice(1).join(' ').trim()
  };
}


/* ============================================================
 * پاک‌سازی لینک‌ها و ویرایش سبک خبر پیش از انتشار
 * ============================================================
 */

function stripLinksAndIds(value) {
  return String(value || '')
    // لینک‌های وب و اپ‌های ایرانی
    .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/\b(?:t|telegram)\.me\/\S+/gi, ' ')
    .replace(/\b(?:ble|bale|eitaa|rubika|sapp|igap|whatsapp)\.(?:ir|com)\/\S+/gi, ' ')
    .replace(/\binstagram\.com\/\S+/gi, ' ')
    // یوزرنیم‌ها
    .replace(/@[A-Za-z0-9_]{3,}/g, ' ')
    // هشتگ‌ها (برند کانال‌ها و تبلیغات)
    .replace(/#[\u0600-\u06FFA-Za-z0-9_]+/g, ' ')
    // عبارت‌های تبلیغاتی
    .replace(/(?:گزارش|خبر|عکس|فیلم|منبع|ارسال)\s*[:：]\s*[^\n]{0,60}$/gim, ' ')
    .replace(/(?:دنبال کنید|عضو شوید|کلیک کنید|کانال ما|لینک زیر|ادامه در|بازنشر)/g, ' ')
    .replace(/(?:مرجع اخبار|اخبار داغ)[^\n]{0,80}/g, ' ');
}

function lightEdit(value) {
  let text = stripLinksAndIds(value);

  text = String(text || '')
    // نیم‌فاصله درست
    .replace(/(^|[\s(«"'])می\s+/g, '$1می')
    .replace(/(^|[\s(«"'])نمی\s+/g, '$1نمی')
    .replace(/\s+ها\b/g, '‌ها')
    .replace(/\s+های\b/g, '‌های')
    .replace(/\s+تر\b/g, '‌تر')
    .replace(/\s+ترین\b/g, '‌ترین')
    // فاصله‌گذاری علائم
    .replace(/\s+([،؛:.!؟])/g, '$1')
    .replace(/([،؛])(?=\S)/g, '$1 ')
    // کلمه تکراری پشت سر هم
    .replace(/\b(\S{2,})\s+\1\b/g, '$1')
    // فاصله‌های اضافی و خطوط خالی
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[\s،؛:._-]+/, '')
    .trim();

  if (!text) return '';

  // جمله آخر نقطه داشته باشد
  if (!/[.!؟…»)]$/.test(text)) text += '.';

  return text;
}
