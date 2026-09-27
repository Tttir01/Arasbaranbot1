'use strict';

const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHANNEL_ID;

function telegramRequest(method, data = {}) {
  return new Promise((resolve, reject) => {
    if (!BOT_TOKEN) {
      reject(new Error('TELEGRAM_BOT_TOKEN تنظیم نشده است.'));
      return;
    }

    if (!CHAT_ID) {
      reject(new Error('TELEGRAM_CHANNEL_ID تنظیم نشده است.'));
      return;
    }

    const payload = JSON.stringify(data);

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const request = https.request(options, response => {
      let body = '';

      response.on('data', chunk => {
        body += chunk;
      });

      response.on('end', () => {
        try {
          const result = JSON.parse(body);

          if (!result.ok) {
            reject(
              new Error(
                result.description || 'Telegram API error'
              )
            );
            return;
          }

          resolve(result.result);
        } catch (error) {
          reject(
            new Error(
              `پاسخ نامعتبر تلگرام: ${body}`
            )
          );
        }
      });
    });

    request.on('error', reject);

    request.write(payload);
    request.end();
  });
}

/*
 * بررسی اتصال ربات
 */
async function getMe() {
  return telegramRequest('getMe');
}

/*
 * ارسال متن
 */
async function sendMessage(text) {
  if (!text || !String(text).trim()) {
    throw new Error('متن پیام خالی است.');
  }

  return telegramRequest('sendMessage', {
    chat_id: CHAT_ID,
    text: String(text),
    disable_web_page_preview: true
  });
}

/*
 * ارسال عکس
 */
async function sendPhoto(photo, caption = '') {
  if (!photo) {
    throw new Error('آدرس عکس خالی است.');
  }

  const data = {
    chat_id: CHAT_ID,
    photo: String(photo)
  };

  if (caption && String(caption).trim()) {
    data.caption = String(caption).substring(0, 1024);
  }

  return telegramRequest('sendPhoto', data);
}

/*
 * ارسال ویدئو
 */
async function sendVideo(video, caption = '') {
  if (!video) {
    throw new Error('آدرس ویدئو خالی است.');
  }

  const data = {
    chat_id: CHAT_ID,
    video: String(video)
  };

  if (caption && String(caption).trim()) {
    data.caption = String(caption).substring(0, 1024);
  }

  return telegramRequest('sendVideo', data);
}

module.exports = {
  getMe,
  sendMessage,
  sendPhoto,
  sendVideo
};
