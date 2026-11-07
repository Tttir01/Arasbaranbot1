'use strict';

const CHANNEL_ID = '@varzqannews';
const REWRITE_MODEL = process.env.REWRITE_MODEL || 'gpt-6-luna';
const REWRITE_TIMEOUT_MS = Number(process.env.REWRITE_TIMEOUT_MS || 20000);

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

async function rewriteWithAI(title, body) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const input = [
    'عنوان منبع:', title || '', '',
    'متن منبع:', body || ''
  ].join('\n');

  const instructions = [
    'تو ویراستار ارشد یک رسانه محلی فارسی هستی.',
    'خبر زیر را از صفر و با ساختار کاملاً جدید بازنویسی کن.',
    'خروجی نباید بازنویسی کلمه‌به‌کلمه یا نزدیک به متن منبع باشد.',
    'تیتر را نیز کاملاً جدید، کوتاه و خبری بنویس.',
    'فقط واقعیت‌ها، اعداد، نام مکان‌ها، اشخاص، زمان‌ها و نتیجه رویداد را حفظ کن.',
    'جملات، ترتیب اطلاعات و زاویه روایت را تغییر بده.',
    'از حدس، اطلاعات تازه، نظر شخصی یا ادعای تأییدنشده خودداری کن.',
    'نام رسانه، عبارت منبع، URL، لینک، @username، تبلیغ و هشتگ را حذف کن.',
    'خروجی دقیقاً با این قالب باشد:',
    'TITLE: تیتر جدید',
    'BODY: متن بازنویسی‌شده در یک یا دو پاراگراف کوتاه',
    'فارسی روان، طبیعی و مناسب انتشار در کانال خبری بنویس.'
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REWRITE_TIMEOUT_MS);

  try {
    const response = await fetch(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: REWRITE_MODEL,
          instructions,
          input,
          max_output_tokens: 500
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error('OpenAI HTTP ' + response.status + ': ' + errorText.slice(0, 300));
    }

    const data = await response.json();
    const output = data.output_text || (Array.isArray(data.output)
      ? data.output.flatMap(item => item.content || [])
          .filter(part => part.type === 'output_text')
          .map(part => part.text).join('\n')
      : '');

    if (!output) throw new Error('OpenAI returned empty rewrite');

    const titleMatch = output.match(/TITLE:\s*(.+)/i);
    const bodyMatch = output.match(/BODY:\s*([\s\S]+)/i);
    const newTitle = cleanText(titleMatch ? titleMatch[1] : title);
    const newBody = cleanText(bodyMatch ? bodyMatch[1] : output);
    if (!newTitle || !newBody) return null;

    const original = (title || '') + ' ' + (body || '');
    const rewritten = newTitle + ' ' + newBody;
    if (similarityRatio(original, rewritten) > 0.68) {
      console.log('⚠️ بازنویسی AI بیش از حد شبیه منبع بود؛ نسخه محلی استفاده می‌شود.');
      return null;
    }

    return { title: newTitle, body: newBody };
  } finally {
    clearTimeout(timer);
  }
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

  let title = cleanTitle(item.title);

  let description = makeSummary(
    item.description || item.content || item.summary || item.text,
    forPhoto ? 560 : 1000
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

  try {
    const rewritten = await rewriteWithAI(title, description);
    if (rewritten) {
      finalTitle = rewritten.title;
      description = rewritten.body;
    }
  } catch (error) {
    console.log('⚠️ بازنویسی AI در دسترس نبود: ' + error.message);
  }

  // در خبرهای کانال تلگرامی، کل متن داخل تیتر است؛ تیتر کوتاه می‌شود
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

  parts.push(
    `🕐 ${date} - ${time}`
  );


  parts.push(
    CHANNEL_ID
  );

  let text =
    parts.join('\n\n').trim();

  if (
    forPhoto &&
    text.length > 950
  ) {
    text = [
      `📰 ${finalTitle}`,
      source,
      makeSummary(
        item.description || item.content || item.summary || item.text,
        420
      ),
      `🕐 ${date} - ${time}`,
      sourceUrl ? '🔗 لینک منبع: ' + sourceUrl : '',
      CHANNEL_ID
    ]
      .filter(Boolean)
      .join('\n\n');

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
