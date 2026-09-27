'use strict';

const { fetchAllNews } = require('./news');
const { formatNews } = require('./formatter');
const { hasNews, saveNews } = require('./storage');
const { sendMessage } = require('./telegram');
const { getConfig } = require('./config');

async function main() {
  console.log('================================');
  console.log('Arasbaran News Bot');
  console.log('================================');

  const config = getConfig();

  console.log('در حال دریافت اخبار...');
  console.log('--------------------------------');

  const news = await fetchAllNews();

  console.log(
    `تعداد اخبار دریافت‌شده: ${news.length}`
  );

  console.log('--------------------------------');

  if (news.length === 0) {
    console.log(
      'هیچ خبری از منابع دریافت نشد.'
    );

    console.log(
      'لطفاً خطاهای منابع RSS را در لاگ بررسی کنید.'
    );

    console.log('================================');

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
        console.log(
          'خبر بدون شناسه رد شد.'
        );

        continue;
      }

      /*
       * جلوگیری از ارسال خبر تکراری
       */
      if (hasNews(id)) {
        skipped++;

        console.log(
          `تکراری: ${item.title || 'بدون عنوان'}`
        );

        continue;
      }

      /*
       * ساخت متن خبر
       */
      const message = formatNews(
        item,
        {
          timezone:
            config.timezone,

          maxDescriptionLength: 500
        }
      );

      if (!message) {
        console.log(
          `متن خبر خالی است: ${item.title || 'بدون عنوان'}`
        );

        continue;
      }

      /*
       * ارسال به تلگرام
       */
      await sendMessage(message);

      /*
       * ذخیره شناسه خبر پس از ارسال موفق
       */
      saveNews(id);

      sent++;

      console.log(
        `ارسال شد: ${item.title || 'بدون عنوان'}`
      );

      /*
       * فاصله کوتاه بین ارسال‌ها
       */
      await new Promise(
        resolve => setTimeout(resolve, 1200)
      );

    } catch (error) {
      errors++;

      console.error(
        `خطا در ارسال خبر "${item.title || 'بدون عنوان'}":`
      );

      console.error(
        error.message
      );
    }
  }

  console.log('================================');
  console.log('گزارش نهایی');
  console.log('================================');

  console.log(
    `تعداد اخبار دریافت‌شده: ${news.length}`
  );

  console.log(
    `تعداد ارسال موفق: ${sent}`
  );

  console.log(
    `تعداد اخبار تکراری: ${skipped}`
  );

  console.log(
    `تعداد خطاها: ${errors}`
  );

  console.log('================================');
  console.log(
    'Arasbaran News Bot finished.'
  );
}

main().catch(error => {
  console.error('================================');
  console.error('FATAL ERROR');
  console.error('================================');

  console.error(
    error.stack || error.message
  );

  process.exit(1);
});
