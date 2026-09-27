'use strict';

const { fetchAllNews } = require('./news');
const { formatNews } = require('./formatter');
const { hasNews, saveNews } = require('./storage');
const { sendMessage } = require('./telegram');
const { getConfig } = require('./config');

async function main() {
  console.log('================================');
  console.log('ARASBARAN NEWS BOT');
  console.log('================================');

  const config = getConfig();

  console.log('در حال دریافت اخبار...');

  const news = await fetchAllNews();

  console.log(
    `تعداد اخبار دریافت‌شده: ${news.length}`
  );

  if (news.length === 0) {
    console.log('هیچ خبر جدیدی دریافت نشد.');
    return;
  }

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of news) {
    try {
      const id = item.id || item.link;

      if (!id) {
        continue;
      }

      if (hasNews(id)) {
        skipped++;
        continue;
      }

      const message = formatNews(item, {
        timezone: config.timezone,
        maxDescriptionLength: 500
      });

      if (!message) {
        continue;
      }

      console.log(
        `در حال ارسال: ${item.title}`
      );

      await sendMessage(message);

      saveNews(id);

      sent++;

      console.log(
        `✅ ارسال شد: ${item.title}`
      );

      await new Promise(
        resolve => setTimeout(resolve, 1200)
      );

    } catch (error) {
      errors++;

      console.error(
        `❌ خطا در ارسال: ${item.title || 'بدون عنوان'}`
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
    `اخبار دریافت‌شده: ${news.length}`
  );

  console.log(
    `ارسال موفق: ${sent}`
  );

  console.log(
    `تکراری: ${skipped}`
  );

  console.log(
    `خطا: ${errors}`
  );

  console.log('================================');
}

main().catch(error => {
  console.error('FATAL ERROR:');
  console.error(error.stack || error.message);
  process.exit(1);
});
