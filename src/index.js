'use strict';

const { fetchAllNews } = require('./news');
const { formatNews } = require('./formatter');
const { hasNews, saveNews } = require('./storage');

const {
  sendMessage,
  sendPhoto,
  sendVideo
} = require('./telegram');

const { getConfig } = require('./config');

async function sendNewsItem(item, message) {
  /*
   * اگر ویدئو وجود داشته باشد، ابتدا ویدئو ارسال می‌شود.
   */
  if (item.videoUrl) {
    try {
      await sendVideo(
        item.videoUrl,
        message
      );

      console.log('🎥 ویدئو ارسال شد.');

      return 'video';
    } catch (error) {
      console.error(
        '⚠️ ارسال ویدئو ناموفق بود:',
        error.message
      );

      /*
       * اگر ویدئو نشد، در صورت وجود عکس
       * عکس را امتحان می‌کنیم.
       */
    }
  }

  /*
   * اگر عکس وجود داشته باشد.
   */
  if (item.imageUrl) {
    try {
      await sendPhoto(
        item.imageUrl,
        message
      );

      console.log('🖼️ عکس ارسال شد.');

      return 'photo';
    } catch (error) {
      console.error(
        '⚠️ ارسال عکس ناموفق بود:',
        error.message
      );
    }
  }

  /*
   * اگر رسانه وجود نداشت یا ارسال آن شکست خورد،
   * متن خبر ارسال می‌شود.
   */
  await sendMessage(message);

  console.log('📝 متن خبر ارسال شد.');

  return 'text';
}

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
      const id = item.id || item.link;

      if (!id) {
        console.log(
          '⚠️ خبر بدون شناسه رد شد.'
        );

        continue;
      }

      /*
       * جلوگیری از ارسال خبر تکراری
       */
      if (hasNews(id)) {
        skipped++;

        console.log(
          `⏭️ خبر تکراری: ${item.title}`
        );

        continue;
      }

      /*
       * ساخت متن نهایی خبر
       */
      const message = formatNews(item, {
        timezone: config.timezone,
        maxDescriptionLength: 650
      });

      if (!message) {
        console.log(
          '⚠️ متن خبر خالی است.'
        );

        continue;
      }

      console.log(
        '--------------------------------'
      );

      console.log(
        `📰 خبر: ${item.title}`
      );

      if (item.imageUrl) {
        console.log(
          `🖼️ تصویر: ${item.imageUrl}`
        );
      }

      if (item.videoUrl) {
        console.log(
          `🎥 ویدئو: ${item.videoUrl}`
        );
      }

      /*
       * ارسال خبر
       */
      const type = await sendNewsItem(
        item,
        message
      );

      /*
       * فقط بعد از ارسال موفق،
       * خبر در تاریخچه ذخیره می‌شود.
       */
      saveNews(id);

      sent++;

      console.log(
        `✅ خبر با موفقیت ارسال شد (${type})`
      );

      /*
       * فاصله بین ارسال خبرها
       */
      await new Promise(
        resolve => setTimeout(resolve, 1500)
      );

    } catch (error) {
      errors++;

      console.error(
        `❌ خطا در ارسال خبر: ${
          item.title || 'بدون عنوان'
        }`
      );

      console.error(
        error.stack || error.message
      );
    }
  }

  console.log('');
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
  console.error('');
  console.error('FATAL ERROR:');
  console.error(
    error.stack || error.message
  );

  process.exit(1);
});
