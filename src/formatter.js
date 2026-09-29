'use strict';

const CHANNEL_ID = '@arrasbarannews';

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

function formatNews(
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

  const description =
    makeSummary(
      item.description,
      forPhoto ? 560 : 1000
    );

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
    `📰 ${title}`
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
