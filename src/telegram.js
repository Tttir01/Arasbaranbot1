'use strict';

const http = require('http');
const https = require('https');

const TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const API =
  `https://api.telegram.org/bot${TOKEN}`;

function telegramRequest(
  method,
  payload
) {
  return new Promise(
    (resolve, reject) => {
      const url =
        new URL(`${API}/${method}`);

      const body =
        JSON.stringify(payload);

      const req =
        https.request(
          {
            hostname:
              url.hostname,
            path:
              url.pathname,
            method:
              'POST',
            headers: {
              'Content-Type':
                'application/json',
              'Content-Length':
                Buffer.byteLength(body)
            },
            timeout: 30000
          },
          res => {
            let data = '';

            res.on(
              'data',
              chunk => {
                data += chunk;
              }
            );

            res.on(
              'end',
              () => {
                try {
                  const json =
                    JSON.parse(data);

                  if (!json.ok) {
                    reject(
                      new Error(
                        json.description ||
                        `Telegram API ${res.statusCode}`
                      )
                    );
                    return;
                  }

                  resolve(
                    json.result
                  );
                } catch (error) {
                  reject(error);
                }
              }
            );
          }
        );

      req.on(
        'timeout',
        () => {
          req.destroy(
            new Error(
              'Telegram request timeout'
            )
          );
        }
      );

      req.on(
        'error',
        reject
      );

      req.write(body);
      req.end();
    }
  );
}

function downloadBuffer(
  url,
  redirects = 0
) {
  return new Promise(
    (resolve, reject) => {
      if (redirects > 6) {
        reject(
          new Error(
            'Redirect limit exceeded'
          )
        );
        return;
      }

      let parsed;

      try {
        parsed =
          new URL(url);
      } catch {
        reject(
          new Error(
            'URL تصویر نامعتبر است'
          )
        );
        return;
      }

      const client =
        parsed.protocol === 'https:'
          ? https
          : http;

      const req =
        client.request(
          parsed,
          {
            method: 'GET',
            timeout: 30000,
            headers: {
              'User-Agent':
                'Mozilla/5.0',
              Accept:
                'image/avif,image/webp,image/apng,image/*,*/*'
            }
          },
          res => {
            const status =
              res.statusCode || 0;

            if (
              [301,302,303,307,308]
                .includes(status) &&
              res.headers.location
            ) {
              res.resume();

              const next =
                new URL(
                  res.headers.location,
                  url
                ).href;

              downloadBuffer(
                next,
                redirects + 1
              )
                .then(resolve)
                .catch(reject);

              return;
            }

            if (
              status < 200 ||
              status >= 400
            ) {
              res.resume();

              reject(
                new Error(
                  `Image HTTP ${status}`
                )
              );

              return;
            }

            const chunks = [];

            res.on(
              'data',
              chunk =>
                chunks.push(chunk)
            );

            res.on(
              'end',
              () => {
                resolve({
                  buffer:
                    Buffer.concat(chunks),
                  contentType:
                    res.headers[
                      'content-type'
                    ] || 'image/jpeg'
                });
              }
            );
          }
        );

      req.on(
        'timeout',
        () => {
          req.destroy(
            new Error(
              'Image download timeout'
            )
          );
        }
      );

      req.on(
        'error',
        reject
      );

      req.end();
    }
  );
}

function multipartTelegramRequest(
  method,
  fields,
  fileField,
  fileBuffer,
  fileName,
  contentType
) {
  return new Promise(
    (resolve, reject) => {
      const boundary =
        `----ArasbaranBot${Date.now()}`;

      const chunks = [];

      for (
        const [key, value]
        of Object.entries(fields)
      ) {
        chunks.push(
          Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
            `${String(value)}\r\n`
          )
        );
      }

      chunks.push(
        Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\n` +
          `Content-Type: ${contentType || 'image/jpeg'}\r\n\r\n`
        )
      );

      chunks.push(fileBuffer);

      chunks.push(
        Buffer.from(
          `\r\n--${boundary}--\r\n`
        )
      );

      const body =
        Buffer.concat(chunks);

      const url =
        new URL(
          `${API}/${method}`
        );

      const req =
        https.request(
          {
            hostname:
              url.hostname,
            path:
              url.pathname,
            method:
              'POST',
            headers: {
              'Content-Type':
                `multipart/form-data; boundary=${boundary}`,
              'Content-Length':
                body.length
            },
            timeout: 60000
          },
          res => {
            let data = '';

            res.on(
              'data',
              chunk => {
                data += chunk;
              }
            );

            res.on(
              'end',
              () => {
                try {
                  const json =
                    JSON.parse(data);

                  if (!json.ok) {
                    reject(
                      new Error(
                        json.description ||
                        `Telegram ${res.statusCode}`
                      )
                    );
                    return;
                  }

                  resolve(
                    json.result
                  );
                } catch (error) {
                  reject(error);
                }
              }
            );
          }
        );

      req.on(
        'timeout',
        () => {
          req.destroy(
            new Error(
              'Multipart timeout'
            )
          );
        }
      );

      req.on(
        'error',
        reject
      );

      req.write(body);
      req.end();
    }
  );
}

async function getMe() {
  return telegramRequest(
    'getMe',
    {}
  );
}

async function getChat(chatId) {
  return telegramRequest(
    'getChat',
    {
      chat_id: chatId || process.env.TELEGRAM_CHANNEL_ID
    }
  );
}

async function getChatMember(chatId, userId) {
  return telegramRequest(
    'getChatMember',
    {
      chat_id: chatId || process.env.TELEGRAM_CHANNEL_ID,
      user_id: userId
    }
  );
}

async function getChatAdministrators(chatId) {
  return telegramRequest('getChatAdministrators', {
    chat_id: chatId || process.env.TELEGRAM_CHANNEL_ID
  });
}

async function getTargetChatInfo() {
  const chatId = process.env.TELEGRAM_CHANNEL_ID;

  if (!chatId) {
    throw new Error(
      'TELEGRAM_CHANNEL_ID تنظیم نشده است.'
    );
  }

  const bot = await getMe();
  const chat = await getChat(chatId);
  const member = await getChatMember(chatId, bot.id);

  return {
    bot,
    chat,
    member
  };
}

async function sendMessage(text) {
  const chatId =
    process.env.TELEGRAM_CHANNEL_ID;

  if (!chatId) {
    throw new Error(
      'TELEGRAM_CHANNEL_ID تنظیم نشده است.'
    );
  }

  return telegramRequest(
    'sendMessage',
    {
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    }
  );
}

async function sendPhoto(
  photo,
  caption = ''
) {
  const chatId =
    process.env.TELEGRAM_CHANNEL_ID;

  if (!chatId) {
    throw new Error(
      'TELEGRAM_CHANNEL_ID تنظیم نشده است.'
    );
  }

  try {
    return await telegramRequest(
      'sendPhoto',
      {
        chat_id: chatId,
        photo,
        caption
      }
    );
  } catch (firstError) {
    console.log(
      `⚠️ ارسال مستقیم تصویر ناموفق بود: ${firstError.message}`
    );

    const downloaded =
      await downloadBuffer(photo);

    return multipartTelegramRequest(
      'sendPhoto',
      {
        chat_id: chatId,
        caption
      },
      'photo',
      downloaded.buffer,
      'news.jpg',
      downloaded.contentType
    );
  }
}

async function sendVideo(
  video,
  caption = ''
) {
  const chatId =
    process.env.TELEGRAM_CHANNEL_ID;

  return telegramRequest(
    'sendVideo',
    {
      chat_id: chatId,
      video,
      caption
    }
  );
}

module.exports = {
  getMe,
  getChat,
  getChatMember,
  getChatAdministrators,
  getTargetChatInfo,
  sendMessage,
  sendPhoto,
  sendVideo,
  telegramRequest
};
