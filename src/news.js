'use strict';

const Parser = require('rss-parser');
const cheerio = require('cheerio');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const { loadSources } = require('./sources');

const parser = new Parser({
  timeout: Number(process.env.REQUEST_TIMEOUT || 25000),
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36'
  }
});

const MAX_AGE_HOURS = Number(process.env.MAX_NEWS_AGE_HOURS || 48);
const MAX_ITEMS_PER_SOURCE = Number(process.env.MAX_ITEMS_PER_SOURCE || 20);
const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT || 25000);

const AREA_KEYWORDS = [
  'ورزقان',
  'خاروانا',
  'اهر',
  'کلیبر',
  'كليبر',
  'هوراند',
  'خداآفرین',
  'خداآفرين',
  'خدا آفرین',
  'خدا آفرين',
  'ارسباران',
  'قره داغ',
  'قره‌داغ',
  'سونگون'
];

const FOREIGN_KEYWORDS = [
  'آمریکا',
  'امریکا',
  'ترامپ',
  'اسرائیل',
  'اوکراین',
  'روسیه',
  'چین',
  'انگلیس',
  'بریتانیا',
  'فرانسه',
  'جنگ غزه',
  'غزه',
  'لبنان',
  'ناتو'
];

function normalizeText(value) {
  return String(value || '')
    .replace(/\u200c/g, ' ')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ۀة]/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(value) {
  if (!value) return '';

  return cheerio
    .load(`<div>${String(value)}</div>`)('div')
    .text()
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(value) {
  return cheerio
    .load(`<div>${String(value || '')}</div>`)('div')
    .text()
    .trim();
}

function cleanNewsText(value) {
  let text = stripHtml(value || '');

  text = text
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/www\.\S+/gi, '')
    .replace(/instagram\.com\/\S+/gi, '')
    .replace(/t\.me\/\S+/gi, '')
    .replace(/@\w+/g, '')
    .replace(/🆔/g, '')
    .replace(/👁‍🗨/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

function normalizeUrl(url, baseUrl) {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return '';
  }
}

function requestBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('URL خالی است.'));
      return;
    }

    if (redirects > 6) {
      reject(new Error('تعداد Redirect بیش از حد مجاز است.'));
      return;
    }

    let parsed;

    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(`URL نامعتبر: ${url}`));
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;

    const req = client.request(
      parsed,
      {
        method: 'GET',
        timeout: REQUEST_TIMEOUT,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml,image/avif,image/webp,*/*'
        }
      },
      res => {
        const status = res.statusCode || 0;

        if (
          [301, 302, 303, 307, 308].includes(status) &&
          res.headers.location
        ) {
          res.resume();

          const next = normalizeUrl(res.headers.location, url);

          requestBuffer(next, redirects + 1)
            .then(resolve)
            .catch(reject);

          return;
        }

        const chunks = [];

        res.on('data', chunk => chunks.push(chunk));

        res.on('end', () => {
          const buffer = Buffer.concat(chunks);

          if (status < 200 || status >= 400) {
            reject(new Error(`HTTP ${status} برای ${url}`));
            return;
          }

          resolve({
            buffer,
            status,
            headers: res.headers
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout: ${url}`));
    });

    req.on('error', reject);

    req.end();
  });
}

async function httpGet(url) {
  const result = await requestBuffer(url);

  return {
    body: result.buffer.toString('utf8'),
    status: result.status,
    headers: result.headers
  };
}

function parseDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  const raw = String(value).trim();

  if (!raw) return null;

  const direct = new Date(raw);

  if (!isNaN(direct.getTime())) {
    return direct;
  }

  const normalized = raw
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\u200c/g, ' ')
    .trim();

  const match = normalized.match(
    /(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[ T،,-]+(\d{1,2})(?::(\d{1,2}))?)?/
  );

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);

  if (year >= 1300 && year <= 1500) {
    const g = jalaliToGregorian(year, month, day);

    const result = new Date(
      Date.UTC(g.gy, g.gm - 1, g.gd, hour, minute)
    );

    return isNaN(result.getTime()) ? null : result;
  }

  const result = new Date(
    year,
    month - 1,
    day,
    hour,
    minute
  );

  return isNaN(result.getTime()) ? null : result;
}

function jalaliToGregorian(jy, jm, jd) {
  let gy;

  if (jy > 979) {
    gy = 1600;
    jy -= 979;
  } else {
    gy = 621;
  }

  let jDayNo =
    365 * jy +
    Math.floor(jy / 33) * 8 +
    Math.floor(((jy % 33) + 3) / 4) +
    78 +
    jd +
    (jm < 7 ? (jm - 1) * 31
