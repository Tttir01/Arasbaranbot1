'use strict';

/**
 * قالب‌بندی خبر برای کانال اخبار ارسباران
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

function formatPersianDate(date, timezone = 'Asia/Tehran') {
  const formatter = new Intl.DateTimeFormat('fa-IR', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  return formatter.format(date);
}

function formatPersianTime(date, timezone = 'Asia/Tehran') {
  const formatter = new Intl.DateTimeFormat('fa-IR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  return formatter.format(date);
}

function cleanText(text) {
  if (!text) return '';

  return String(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function shortenText(text, maxLength = 500) {
  const clean = cleanText(text);

  if (clean.length <= maxLength) {
    return clean;
  }

  return clean.substring(0, maxLength - 3).trim() + '...';
}

function getSourceName(item) {
  if (item.sourceName) {
    return cleanText(item.sourceName);
  }

  if (item.source) {
    return cleanText(item.source);
  }

  return 'منابع خبری';
}

function formatNews(item, options = {}) {
  const timezone = options.timezone || 'Asia/Tehran';

  const title = cleanText(item.title || 'بدون عنوان');

  const description = shortenText(
    item.description || item.content || '',
    options.maxDescriptionLength || 500
  );

  const sourceName = getSourceName(item);

  const publishedAt = item.publishedAt
    ? new Date(item.publishedAt)
    : new Date();

  const date = formatPersianDate(publishedAt, timezone);
  const time = formatPersianTime(publishedAt, timezone);

  let text = '';

  text += `📰 ${title}\n\n`;

  text += `به گزارش اخبار ارسباران به نقل از ${sourceName}، `;

  if (description) {
    text += `${description}\n\n`;
  } else {
    text += `${title}\n\n`;
  }

  text += `🕐 زمان خبر: ${date} - ${time}\n`;

  text += `📍 اخبار ارسباران`;

  return text;
}

function formatNewsList(items, options = {}) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map(item => formatNews(item, options));
}

module.exports = {
  toPersianDigits,
  formatPersianDate,
  formatPersianTime,
  cleanText,
  shortenText,
  formatNews,
  formatNewsList
};
