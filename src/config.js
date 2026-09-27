'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({
  path: path.resolve(process.cwd(), '.env')
});

function required(name) {
  const value = process.env[name];

  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return String(value).trim();
}

function getConfig() {
  return {
    telegram: {
      botToken: required('TELEGRAM_BOT_TOKEN'),
      channelId: required('TELEGRAM_CHANNEL_ID')
    },

    news: {
      maxItemsPerSource: Number(
        process.env.MAX_ITEMS_PER_SOURCE || 10
      ),

      maxTotalItems: Number(
        process.env.MAX_TOTAL_ITEMS || 30
      ),

      requestTimeout: Number(
        process.env.REQUEST_TIMEOUT || 25000
      )
    },

    timezone: process.env.TIMEZONE || 'Asia/Tehran',

    dataFile: path.resolve(
      process.env.DATA_FILE || 'data/news-history.json'
    )
  };
}

module.exports = {
  getConfig
};
