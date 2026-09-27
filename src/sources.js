'use strict';

const fs = require('fs');
const path = require('path');

const SOURCES_FILE = path.resolve(
  process.cwd(),
  'config',
  'sources.json'
);

function loadSources() {
  if (!fs.existsSync(SOURCES_FILE)) {
    throw new Error(
      `فایل منابع پیدا نشد: ${SOURCES_FILE}`
    );
  }

  const raw = fs.readFileSync(
    SOURCES_FILE,
    'utf8'
  );

  let data;

  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `خطا در خواندن sources.json: ${error.message}`
    );
  }

  if (!data || !Array.isArray(data.sources)) {
    throw new Error(
      'ساختار sources.json صحیح نیست. کلید sources باید آرایه باشد.'
    );
  }

  return data.sources.filter(
    source => source && source.enabled !== false
  );
}

function getSourceById(id) {
  const sources = loadSources();

  return sources.find(
    source => source.id === id
  ) || null;
}

function getSourcesByArea(area) {
  const sources = loadSources();

  if (!area) {
    return sources;
  }

  return sources.filter(source => {
    if (!Array.isArray(source.areas)) {
      return false;
    }

    return source.areas.some(
      item =>
        String(item).trim() ===
        String(area).trim()
    );
  });
}

function getGoogleNewsSources() {
  return loadSources().filter(
    source => source.type === 'google-news'
  );
}

module.exports = {
  loadSources,
  getSourceById,
  getSourcesByArea,
  getGoogleNewsSources
};
