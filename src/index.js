'use strict';

const {
  fetchAllNews
} = require('./news');

const {
  formatNews
} = require('./formatter');

const {
  hasNews,
  saveNews
} = require('./storage');

const {
  sendMessage,
  sendPhoto,
  sendVideo
} = require('./telegram');

const {
  getConfig
} = require('./config');

async function sendNewsItem(
  item,
  message
) {
  if (item.videoUrl) {
    try {
      await sendVideo(
        item.videoUrl,
        message
      );

      console.log(
        '🎥 ویدئو ارسال شد.'
      );

      return 'video';
    } catch (error) {
      console.error(
        '⚠️ ویدئو ارسال نشد:',
        error.message
      );
    }
  }

  if (item.imageUrl) {
    try {
      await sendPhoto(
        item.imageUrl,
        message
      );

      console.log(
        '🖼️ تصویر ارسال شد.'
      );

      return 'photo';
    } catch (error) {
      console.error(
        '⚠️ تصویر ارسال نشد:',
        error.message
      );
    }
  }

  await sendMessage(message);

  console.log(
    '📝 متن خبر ارسال شد.'
  );

  return 'text';
}

async function main() {
  console.log(
    '================================'
  );

  console.log(
    'ARASBARAN NEWS BOT'
  );

  console.log(
    '================================'
  );

  const config =
    getConfig();

  console.log(
    'در حال دریافت اخبار...'
  );

  const news =
    await fetchAllNews();

  console.log(
    `تعداد اخبار دریافت‌شده: ${news.length}`
  );

  if (!news.length) {
    console.log(
      'هیچ خبر جدید و واجد شرایطی دریافت نشد.'
    );

    return;
  }

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of news) {
    try {
      const id =
        item.id ||
        item.link;

      if (!id) {
        continue;
      }

      if (hasNews(id)) {
        skipped++;

        console.log(
          `⏭️ تکراری: ${item.title}`
        );

        continue;
      }

      const message =
        formatNews(
          item,
          {
            timezone:
              config.timezone
          }
        );

      if (!message) {
        continue;
      }

      console.log(
        '--------------------------------'
      );

      console.log(
        `📰 ${item.title}`
      );

      console.log(
        `🔗 ${item.link || '-'}`
      );

      console.log(
        `🕐 ${item.publishedAt || '-'}`
      );

      if (item.imageUrl) {
        console.log(
          `🖼️ ${item.imageUrl}`
        );
      }

      if (item.videoUrl) {
        console.log(
          `🎥 ${item.videoUrl}`
        );
      }

      const type =
        await sendNewsItem(
          item,
          message
        );

      saveNews(id);

      sent++;

      console.log(
        `✅ ارسال موفق (${type})`
      );

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            1500
          )
      );
    } catch (error) {
      errors++;

      console.error(
        `❌ خطا در خبر: ${
          item.title || 'بدون عنوان'
        }`
      );

      console.error(
        error.stack ||
        error.message
      );
    }
  }

  console.log(
    '================================'
  );

  console.log(
    'گزارش نهایی'
  );

  console.log(
    '================================'
  );

  console.log(
    `دریافت: ${news.length}`
  );

  console.log(
    `ارسال: ${sent}`
  );

  console.log(
    `تکراری: ${skipped}`
  );

  console.log(
    `خطا: ${errors}`
  );

  console.log(
    '================================'
  );
}

main().catch(error => {
  console.error(
    'FATAL ERROR:'
  );

  console.error(
    error.stack ||
    error.message
  );

  process.exit(1);
});
