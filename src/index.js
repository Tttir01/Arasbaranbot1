'use strict';

require('dotenv').config();

const { fetchAllNews } = require('./news');
const { loadSources } = require('./sources');
const { formatNews } = require('./formatter');
const { getMe, sendMessage, sendPhoto, sendVideo } = require('./telegram');
const { publishNews: publishInstagram, enabled: instagramEnabled } = require('./instagram');
const { loadHistory, hasNews, saveNews } = require('./storage');

const CONFIG = {
  timezone: process.env.TIMEZONE || 'Asia/Tehran',
  maxPostsPerRun: Number(process.env.MAX_POSTS_PER_RUN || 8)
};

function sourcePriority(source) {
  const name = String(source || '').toLowerCase();

  if (/فرمانداری|بخشداری|شهرداری|استانداری|آموزش و پرورش|جهاد کشاورزی|راهداری|هلال احمر|آب و فاضلاب|آبفا|شرکت گاز|اداره گاز|اداره برق|شرکت برق|شبکه بهداشت|بهداشت و درمان|اورژانس|منابع طبیعی|محیط زیست|صمت|ورزش و جوانان/.test(name)) return 100;
  if (/انعکاس ورزقان|انعکاس اخبار بخش خاروانا|ورزقان خبری|خاروانا|دیزمار|صدای ورزقان|آوای ورزقان|عصر ورزقان/.test(name)) return 96;
  if (/صدا و سیما|irib/.test(name)) return 92;
  if (/تسنیم|ایرنا|ایسنا|مهر/.test(name)) return 88;
  if (/گوگل|google news/.test(name)) return 75;

  return 80;
}

function rankNews(items) {
  return items.slice().sort((a, b) => {
    const pa = sourcePriority(a.source);
    const pb = sourcePriority(b.source);

    if (pa !== pb) return pb - pa;

    const ta = a.publishedDate ? a.publishedDate.getTime() : 0;
    const tb = b.publishedDate ? b.publishedDate.getTime() : 0;

    return tb - ta;
  });
}

async function sendNewsItem(item, message) {
  if (item.imageUrl) {
    try {
      await sendPhoto(item.imageUrl, message);
      return 'photo';
    } catch (error) {
      console.log(`⚠️ ارسال تصویر شکست خورد: ${error.message}`);
    }
  }

  if (item.videoUrl) {
    try {
      await sendVideo(item.videoUrl, message);
      return 'video';
    } catch (error) {
      console.log(`⚠️ ارسال ویدئو شکست خورد: ${error.message}`);
    }
  }

  await sendMessage(message);
  return 'text';
}

async function main() {
  console.log('\n========================================');
  console.log('🇮🇷 ورزقان مدیا | NEWS BOT');
  console.log('========================================\n');

  const me = await getMe();
  console.log(`🤖 Bot: @${me.username || me.first_name}`);
  console.log(`📤 حداکثر ارسال در هر اجرا: ${CONFIG.maxPostsPerRun}`);

  const sources = loadSources();
  console.log(`📡 تعداد منابع بارگذاری‌شده: ${sources.length}`);

  const news = await fetchAllNews(sources);
  console.log(`\n📰 اخبار نهایی از منابع: ${news.length}`);

  if (!news.length) {
    console.log('ℹ️ هیچ خبر جدید و معتبر محلی پیدا نشد.');
    return;
  }

  const history = loadHistory();
  console.log(`🗃️ تعداد سوابق تاریخچه: ${history.length}`);

  const ranked = rankNews(news);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let noDate = 0;
  let noText = 0;

  for (const item of ranked) {
    if (sent >= CONFIG.maxPostsPerRun) {
      console.log('⏹️ سقف ارسال این اجرا تکمیل شد.');
      break;
    }

    const id = item.id || item.hash || item.url || item.link;
    if (!id) {
      skipped++;
      continue;
    }

    if (hasNews(item)) {
      skipped++;
      console.log(`↩️ تکراری از تاریخچه: ${item.title}`);
      continue;
    }

    if (!item.publishedAt) {
      noDate++;
      console.log(`⛔ بدون تاریخ: ${item.title}`);
      continue;
    }

    const message = await formatNews(item, {
      timezone: CONFIG.timezone,
      forPhoto: !!item.imageUrl
    });

    if (!message) {
      noText++;
      console.log(`⛔ متن قابل تولید نیست: ${item.title}`);
      continue;
    }

    console.log('\n----------------------------------------');
    console.log(`📰 ${item.title}`);
    console.log(`📅 ${item.publishedAt}`);
    console.log(`📌 منبع داخلی: ${item.source || 'نامشخص'}`);
    console.log(`🖼️ ${item.imageUrl ? 'دارد' : 'ندارد'}`);

    try {
      const type = await sendNewsItem(item, message);

      // ابتدا تاریخچه تلگرام ثبت می‌شود تا خطای Instagram باعث ارسال تکراری تلگرام نشود.
      saveNews(item);
      sent++;

      console.log(`✅ ارسال شد به Telegram: ${type}`);

      if (instagramEnabled()) {
        try {
          const ig = await publishInstagram(item, message);
          if (ig.skipped) {
            console.log(`ℹ️ Instagram رد شد: ${ig.reason}`);
          } else {
            console.log(`📸 Instagram منتشر شد: ${ig.type} / ${ig.mediaId}`);
          }
        } catch (instagramError) {
          console.log(`⚠️ Instagram منتشر نشد: ${instagramError.message}`);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 1200));
    } catch (error) {
      failed++;
      console.log(`❌ خطا در ارسال: ${error.message}`);
    }
  }

  console.log('\n========================================');
  console.log(`✅ ارسال موفق: ${sent}`);
  console.log(`↩️ تکراری: ${skipped}`);
  console.log(`⛔ بدون تاریخ: ${noDate}`);
  console.log(`⛔ بدون متن: ${noText}`);
  console.log(`❌ خطا: ${failed}`);
  console.log('========================================');
}

main().catch(error => {
  console.error('\n💥 خطای اصلی:', error);
  process.exit(1);
});
