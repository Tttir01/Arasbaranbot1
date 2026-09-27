'use strict';

const fs = require('fs');
const path = require('path');

const DATA_FILE =
  path.resolve(
    process.cwd(),
    process.env.DATA_FILE ||
    'data/news-history.json'
  );

function ensureDataFile() {

  const dir =
    path.dirname(DATA_FILE);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(
      dir,
      {
        recursive: true
      }
    );
  }

  if (!fs.existsSync(DATA_FILE)) {

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          items: []
        },
        null,
        2
      ),
      'utf8'
    );
  }
}

function loadHistory() {

  ensureDataFile();

  try {

    const data =
      JSON.parse(
        fs.readFileSync(
          DATA_FILE,
          'utf8'
        )
      );

    if (Array.isArray(data)) {
      return data;
    }

    if (
      data &&
      Array.isArray(data.items)
    ) {
      return data.items;
    }

    return [];

  } catch (error) {

    console.error(
      'خطا در خواندن تاریخچه:',
      error.message
    );

    return [];
  }
}

function hasNews(id) {

  if (!id) {
    return false;
  }

  const history =
    loadHistory();

  return history.includes(
    String(id)
  );
}

function saveNews(id) {

  if (!id) {
    return;
  }

  const history =
    loadHistory();

  const value =
    String(id);

  if (
    !history.includes(value)
  ) {
    history.push(value);
  }

  const limited =
    history.slice(-5000);

  ensureDataFile();

  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(
      {
        items: limited
      },
      null,
      2
    ),
    'utf8'
  );
}

module.exports = {
  loadHistory,
  hasNews,
  saveNews
};
