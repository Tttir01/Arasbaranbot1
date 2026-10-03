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

function cleanText(text) {
  return String(text || '')
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

  return `به گزارش اخبار ارسباران به نقل از ${name}`;
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

  const title =
    cleanTitle(item.title) ||
    'خبر جدید';

  let description =
    makeSummary(
      item.description,
      forPhoto ? 560 : 1000
    );

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

  const source = '';

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
      `📰 ${title}`,
      source,
      makeSummary(
        item.description,
        500
      ),
      `🕐 ${date} - ${time}`,
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
