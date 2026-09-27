'use strict';

const {
  collectNews
} = require('./news');

const {
  formatNews
} = require('./formatter');

const {
  hasBeenSent,
  markAsSent
} = require('./storage');

const {
  sendNews
} = require('./telegram');

const {
  getConfig
} = require('./config');

const CONFIG = getConfig();

/**
 * اجرای اصلی ربات
 */
async function run() {
  console.log('================================');
  console.log('📰 Arasbaran News Bot');
  console.log('================================');

  console.log('🔄 در حال دریافت اخبار...');

  const newsItems = await collectNews();

  console.log(
    `📥 تعداد اخبار دریافت‌شده: ${newsItems.length}`
  );

  if (newsItems.length === 0) {
    console.log('ℹ️ خبر جدیدی پیدا نشد.');
    return;
  }

  let sentCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const news of newsItems) {
    try {
      /*
       * جلوگیری از ارسال خبر تکراری
       */
      if (hasBeenSent(news.id)) {
        skippedCount++;

        console.log(
          `⏭️ تکراری: ${news.title}`
        );

        continue;
      }

      /*
       * ساخت متن نهایی خبر
       */
      const formattedText = formatNews(
        news,
        {
          timezone: CONFIG.timezone,
          maxDescriptionLength: 500
        }
      );

      /*
       * ارسال به تلگرام
       */
      await sendNews(
        news,
        formattedText
      );

      /*
       * ثبت خبر به عنوان ارسال‌شده
       */
      markAsSent(news);

      sentCount++;

      console.log(
        `✅ ارسال شد: ${news.title}`
      );

      /*
       * فاصله کوتاه بین ارسال‌ها
       * برای جلوگیری از ارسال خیلی سریع
       */
      await sleep(1200);

    } catch (error) {
      errorCount++;

      console.error(
        `❌ خطا در ارسال خبر: ${news.title}`
      );

      console.error(
        error.message
      );
    }
  }

  console.log('================================');
  console.log('📊 گزارش اجرای ربات');
  console.log('================================');

  console.log(
    `📥 دریافت‌شده: ${newsItems.length}`
  );

  console.log(
    `✅ ارسال‌شده: ${sentCount}`
  );

  console.log(
    `⏭️ تکراری: ${skippedCount}`
  );

  console.log(
    `❌ دارای خطا: ${errorCount}`
  );

  console.log('================================');
}

/**
 * تأخیر
 */
function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}

/**
 * اجرای برنامه
 */
run()
  .then(() => {
    console.log(
      '🏁 اجرای ربات به پایان رسید.'
    );
  })
  .catch(error => {
    console.error(
      '💥 خطای اصلی ربات:',
      error
    );

    process.exitCode = 1;
  });
