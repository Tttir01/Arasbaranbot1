'use strict';

const https = require('https');

const BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const CHAT_ID =
  process.env.TELEGRAM_CHANNEL_ID;

function telegramRequest(
  method,
  data = {}
) {
  return new Promise(
    (resolve, reject) => {

      if (!BOT_TOKEN) {
        reject(
          new Error(
            'TELEGRAM_BOT_TOKEN تنظیم نشده است.'
          )
        );
        return;
      }

      const payload =
        JSON.stringify(data);

      const options = {
        hostname: 'api.telegram.org',
        path:
          `/bot${BOT_TOKEN}/${method}`,
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
          'Content-Length':
            Buffer.byteLength(payload)
        }
      };

      const request =
        https.request(
          options,
          response => {

            let body = '';

            response.on(
              'data',
              chunk => {
                body += chunk;
              }
            );

            response.on(
              'end',
              () => {
                try {
                  const result =
                    JSON.parse(body);

                  if (!result.ok) {
                    reject(
                      new Error(
                        result.description ||
                        'Telegram API error'
                      )
                    );
                    return;
                  }

                  resolve(
                    result.result
                  );

                } catch (error) {
                  reject(
                    new Error(
                      `پاسخ نامعتبر تلگرام: ${body}`
                    )
                  );
                }
              }
            );
          }
        );

      request.on(
        'error',
        reject
      );

      request.write(payload);
      request.end();
    }
  );
}

async function getMe() {
  return telegramRequest(
    'getMe'
  );
}

async function sendMessage(text) {

  if (!CHAT_ID) {
    throw new Error(
      'TELEGRAM_CHANNEL_ID تنظیم نشده است.'
    );
  }

  return telegramRequest(
    'sendMessage',
    {
      chat_id: CHAT_ID,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    }
  );
}

module.exports = {
  getMe,
  sendMessage
};
