'use strict';

const { fetchAllNews } = require('./news');

async function main() {
  console.log('================================');
  console.log('ARASBARAN NEWS BOT - TEST MODE');
  console.log('================================');

  console.log('');
  console.log('⚠️ حالت تست فعال است.');
  console.log('⚠️ هیچ پیامی به تلگرام ارسال نخواهد شد.');
  console.log('');

  const news = await fetchAllNews();

  console.log('');
  console.log('================================');
  console.log('نتیجه دریافت اخبار');
  console.log('================================');

  console.log(
    `تعداد اخبار دریافت‌شده: ${news.length}`
  );

  console.log('');

  if (news.length === 0) {
    console.log(
      '❌ هیچ خبری دریافت نشد.'
    );

    console.log(
      'لطفاً خطاهای منابع RSS را بررسی کنید.'
    );

    console.log('================================');

    return;
  }

  news.forEach((item, index) => {
    console.log('');
    console.log(
      `خبر شماره ${index + 1}`
    );

    console.log(
      `عنوان: ${item.title}`
    );

    console.log(
      `منبع: ${item.sourceName}`
    );

    console.log(
      `منطقه: ${
        Array.isArray(item.areas)
          ? item.areas.join('، ')
          : ''
      }`
    );

    console.log(
      `زمان: ${item.publishedAt}`
    );

    console.log(
      `لینک: ${item.link}`
    );

    console.log('--------------------------------');
  });

  console.log('');
  console.log('================================');
  console.log('TEST FINISHED');
  console.log('هیچ پیامی به تلگرام ارسال نشد.');
  console.log('================================');
}

main().catch(error => {
  console.error('');
  console.error('================================');
  console.error('TEST ERROR');
  console.error('================================');

  console.error(
    error.stack || error.message
  );

  process.exit(1);
});
