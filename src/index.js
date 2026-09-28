'use strict';

require('dotenv').config();

const {
  fetchAllNews
} = require('./news');

const {
  formatNews
} = require('./formatter');

const {
  getMe,
  sendMessage,
  sendPhoto,
  sendVideo
} = require('./telegram');

const {
  hasNews,
  saveNews
} = require('./storage');

const CONFIG = {
  timezone:
    process.env.TIMEZONE ||
    'Asia/Tehran'
};

async function sendNewsItem(
  item,
  message
) {
  if (item.imageUrl) {
    try {
      await sendPhoto(
        item.imageUrl,
        message
      );

      return 'photo';
    } catch (error) {
      console.log(
        `⚠️ ارسال تصویر شکست خورد: ${error.message}`
      );
    }
  }

  if (item.videoUrl) {
    try {
      await sendVideo(
        item.videoUrl,
        message
      );

      return 'video';
    } catch (error) {
      console.log(
        `⚠️ ارسال ویدئو شکست خورد: ${error.message}`
      );
    }
  }

  await sendMessage(message);

  return 'text';
}

async function main() {
  console.log(
    '\n========================================'
  );

  console.log(
    '🇮🇷 ARASBARAN NEWS BOT'
  );

  console.log(
    '========================================\n'
  );

  const me =
    await getMe();

  console.log(
    `🤖 Bot: @${me.username || me.first_name}`
  );

  const news =
    await fetchAllNews();

  console.log(
    `\n📰 اخبار نهایی: ${news.length}`
  );

  if (!news.length) {
    console.log(
      'ℹ️ هیچ خبر جدید و معتبر محلی پیدا نشد.'
    );

    return;
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (
    const item of news
  ) {
    const id =
      item.id;

    if (!id) {
      continue;
    }

    if (hasNews(id)) {
      skipped++;

      console.log(
        `↩️ تکراری: ${item.title}`
      );

      continue;
    }

    if (!item.publishedAt) {
      console.log(
        `⛔ خبر بدون تاریخ رد شد: ${item.title}`
      );

      continue;
    }

    const message =
      formatNews(
        item,
        {
          timezone:
            CONFIG.timezone,
          forPhoto:
            !!item.imageUrl
        }
      );

    if (!message) {
      console.log(
        `⛔ متن خبر قابل تولید نیست: ${item.title}`
      );

      continue;
    }

    console.log(
      '\n----------------------------------------'
    );

    console.log(
      `📰 ${item.title}`
    );

    console.log(
      `📅 ${item.publishedAt}`
    );

    console.log(
      `🖼️ ${item.imageUrl || 'بدون تصویر'}`
    );

    console.log(
      `🔗 ${item.link || 'بدون لینک'}`
    );

    try {
      const type =
        await sendNewsItem(
          item,
          message
        );

      saveNews(id);

      sent++;

      console.log(
        `✅ ارسال شد: ${type}`
      );

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            1200
          )
      );
    } catch (error) {
      failed++;

      console.log(
        `❌ خطا در ارسال: ${error.message}`
      );
    }
  }

  console.log(
    '\n========================================'
  );

  console.log(
    `✅ ارسال موفق: ${sent}`
  );

  console.log(
    `↩️ تکراری: ${skipped}`
  );

  console.log(
    `❌ خطا: ${failed}`
  );

  console.log(
    '========================================'
  );
}

main().catch(error => {
  console.error(
    '\n💥 خطای اصلی:',
    error
  );

  process.exit(1);
});
