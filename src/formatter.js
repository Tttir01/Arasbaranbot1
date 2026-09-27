'use strict';

const CHANNEL_ID =
  '@arrasbarannews';

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

function formatPersianDate(
  date,
  timezone = 'Asia/Tehran'
) {
  return new Intl.DateTimeFormat(
    'fa-IR',
    {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  ).format(date);
}

function formatPersianTime(
  date,
  timezone = 'Asia/Tehran'
) {
  return new Intl.DateTimeFormat(
    'fa-IR',
    {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }
  ).format(date);
}

function cleanText(text) {

  if (!text) {
    return '';
  }

  return String(text)
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      ' '
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      ' '
    )
    .replace(
      /<[^>]*>/g,
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
      /\s+/g,
      ' '
    )
    .trim();
}

function cleanNewsText(text) {

  let value =
    cleanText(text);

  value =
    value
      .replace(
        /\s*[-|]\s*(facebook\.com|youtube\.com|instagram\.com)\s*$/i,
        ''
      )
      .replace(
        /\s*[-|]\s*www\.[^\s]+$/i,
        ''
      )
      .trim();

  return value;
}

function cleanTitle(title) {

  let value =
    cleanNewsText(title);

  value =
    value
      .replace(
        /\s*[-–—|]\s*BBC\s*$/i,
        ''
      )
      .replace(
        /\s*[-–—|]\s*تسنیم\s*$/i,
        ''
      )
      .replace(
        /\s*[-–—|]\s*ایرنا\s*$/i,
        ''
      )
      .replace(
        /\s*[-–—|]\s*ایسنا\s*$/i,
        ''
      )
      .replace(
        /\s*[-–—|]\s*فارس\s*$/i,
        ''
      )
      .trim();

  return value;
}

function rewriteDescription(
  text
) {

  let value =
    cleanNewsText(text);

  if (!value) {
    return '';
  }

  value =
    value
      .replace(
        /^به گزارش\s+/i,
        ''
      )
      .replace(
        /^گزارش\s+/i,
        ''
      )
      .replace(
        /^طبق گزارش\s+/i,
        ''
      )
      .replace(
        /^بر اساس گزارش\s+/i,
        ''
      )
      .replace(
        /\s+/g,
        ' '
      )
      .trim();

  if (value.length > 650) {
    value =
      value.substring(
        0,
        647
      ).trim() + '...';
  }

  return value;
}

function formatNews(
  item,
  options = {}
) {

  const timezone =
    options.timezone ||
    'Asia/Tehran';

  const title =
    cleanTitle(
      item.title ||
      'خبر جدید ارسباران'
    );

  const description =
    rewriteDescription(
      item.description ||
      item.content ||
      ''
    );

  const publishedAt =
    item.publishedAt
      ? new Date(
          item.publishedAt
        )
      : new Date();

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

  let text = '';

  text +=
    `📰 ${title}\n\n`;

  if (description) {
    text +=
      `${description}\n\n`;
  }

  text +=
    `🕐 ${date} - ${time}\n\n`;

  text +=
    CHANNEL_ID;

  return text.trim();
}

function formatNewsList(
  items,
  options = {}
) {

  if (!Array.isArray(items)) {
    return [];
  }

  return items.map(
    item =>
      formatNews(
        item,
        options
      )
  );
}

module.exports = {
  toPersianDigits,
  formatPersianDate,
  formatPersianTime,
  cleanText,
  cleanNewsText,
  cleanTitle,
  rewriteDescription,
  formatNews,
  formatNewsList
};
