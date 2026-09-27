'use strict';

const {
  loadSources
} = require('./sources');

const {
  fetchAllNews
} = require('./news');

const {
  formatNewsItem
} = require('./formatter');

const {
  hasNews,
  saveNews
} = require('./storage');

const {
  sendMessage
} = require('./telegram');

async function main() {

  console.log(
    '================================'
  );

  console.log(
    'Arasbaran News Bot'
  );

  console.log(
    '================================'
  );

  const sources =
    loadSources();

  console.log(
    `تعداد منابع فعال: ${sources.length}`
  );

  const news =
    await fetchAllNews(
      sources
    );

  console.log(
    `تعداد اخبار دریافت‌شده: ${news.length}`
  );

  let sent = 0;

  for (const item of news) {

    try {

      const id =
        item.id ||
        item.link ||
        item.guid;

      if (!id) {
        continue;
      }

      if (hasNews(id)) {
        continue;
      }

      const message =
        formatNewsItem(item);

      if (!message) {
        continue;
      }

      await sendMessage(
        message
      );

      saveNews(id);

      sent++;

      console.log(
        `ارسال شد: ${item.title || 'بدون عنوان'}`
      );

    } catch (error) {

      console.error(
        'خطا در پردازش خبر:',
        error.message
      );
    }
  }

  console.log(
    '--------------------------------'
  );

  console.log(
    `تعداد ارسال موفق: ${sent}`
  );

  console.log(
    'Arasbaran News Bot finished.'
  );
}

main().catch(
  error => {

    console.error(
      'FATAL ERROR:'
    );

    console.error(
      error.message
    );

    process.exit(1);
  }
);
