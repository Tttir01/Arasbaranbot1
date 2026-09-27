'use strict';

const https = require('https');

const { getConfig } = require('./config');

const CONFIG = getConfig();

const TELEGRAM_API =
  `https://api.telegram.org/bot${CONFIG.telegram.botToken}`;

/**
 * درخواست به Telegram Bot API
 */
function telegramRequest(method, data = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(
      `${TELEGRAM_API}/${method}`
    );

    const body = JSON.stringify(data);

    const request = https.request(
      url,
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },

        timeout: 30000
      },
      response => {
        let responseData = '';

        response.on(
          'data',
          chunk => {
            responseData += chunk;
          }
        );

        response.on(
          'end',
          () => {
            try {
              const result =
                JSON.parse(responseData);

              if (!result.ok) {
                reject(
                  new Error(
                    result.description ||
                    `Telegram API error: ${method}`
                  )
                );

                return;
              }

              resolve(result.result);

            } catch (error) {
              reject(
                new Error(
                  `پاسخ نامعتبر از Telegram API: ${error.message}`
                )
              );
            }
          }
        );
      }
    );

    request.on(
      'timeout',
      () => {
        request.destroy(
          new Error(
            'زمان درخواست به Telegram تمام شد.'
          )
        );
      }
    );

    request.on(
      'error',
      error => {
        reject(error);
      }
    );

    request.write(body);
    request.end();
  });
}

/**
 * بررسی اتصال ربات
 */
async function getMe() {
  return telegramRequest('getMe');
}

/**
 * ارسال پیام متنی
 */
async function sendMessage(
  text,
  options = {}
) {
  if (!text || !String(text).trim()) {
    throw new Error(
      'متن پیام خالی است.'
    );
  }

  const data = {
    chat_id:
      options.chatId ||
      CONFIG.telegram.channelId,

    text: String(text),

    disable_web_page_preview:
      options.disableWebPagePreview !== false
  };

  if (options.parseMode) {
    data.parse_mode =
      options.parseMode;
  }

  if (options.replyToMessageId) {
    data.reply_to_message_id =
      options.replyToMessageId;
  }

  return telegramRequest(
    'sendMessage',
    data
  );
}

/**
 * ارسال عکس همراه با توضیح
 */
async function sendPhoto(
  photo,
  caption = '',
  options = {}
) {
  if (!photo) {
    throw new Error(
      'آدرس یا شناسه تصویر مشخص نشده است.'
    );
  }

  const data = {
    chat_id:
      options.chatId ||
      CONFIG.telegram.channelId,

    photo: photo
  };

  if (caption) {
    data.caption =
      String(caption).substring(0, 1024);
  }

  if (options.parseMode) {
    data.parse_mode =
      options.parseMode;
  }

  return telegramRequest(
    'sendPhoto',
    data
  );
}

/**
 * ارسال خبر
 *
 * اگر خبر تصویر داشته باشد:
 * sendPhoto
 *
 * در غیر این صورت:
 * sendMessage
 */
async function sendNews(news, formattedText) {
  if (!news) {
    throw new Error(
      'خبر برای ارسال مشخص نشده است.'
    );
  }

  const text =
    formattedText ||
    news.formattedText ||
    news.title ||
    '';

  /*
   * اگر تصویر موجود باشد
   */
  if (news.imageUrl) {
    try {
      return await sendPhoto(
        news.imageUrl,
        text
      );
    } catch (error) {
      console.error(
        'ارسال تصویر ناموفق بود؛ ارسال متن انجام می‌شود:',
        error.message
      );
    }
  }

  return sendMessage(text);
}

/**
 * تست ارسال پیام
 */
async function sendTestMessage(text) {
  const message =
    text ||
    '✅ اتصال ربات اخبار ارسباران به تلگرام موفق است.';

  return sendMessage(message);
}

module.exports = {
  telegramRequest,
  getMe,
  sendMessage,
  sendPhoto,
  sendNews,
  sendTestMessage
};
