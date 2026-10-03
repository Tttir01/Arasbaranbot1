'use strict';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH_BASE = 'https://graph.facebook.com/' + GRAPH_VERSION;

function enabled() {
  return String(process.env.INSTAGRAM_ENABLED || 'false').toLowerCase() === 'true';
}

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error('Instagram: secret ' + name + ' تنظیم نشده است.');
  return value;
}

async function graphPost(path, body) {
  const response = await fetch(GRAPH_BASE + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {raw: text}; }
  if (!response.ok || data.error) {
    throw new Error('Instagram Graph API: ' + (data?.error?.message || ('HTTP ' + response.status)));
  }
  return data;
}

async function publishImage({imageUrl, caption}) {
  const igUserId = required('INSTAGRAM_USER_ID');
  const accessToken = required('INSTAGRAM_ACCESS_TOKEN');

  if (!/^https?:\/\//i.test(String(imageUrl || ''))) {
    throw new Error('URL تصویر برای Instagram عمومی و معتبر نیست.');
  }

  const container = await graphPost('/' + encodeURIComponent(igUserId) + '/media', {
    image_url: imageUrl,
    caption: caption || '',
    access_token: accessToken
  });

  if (!container.id) throw new Error('Instagram image container ساخته نشد.');

  const published = await graphPost('/' + encodeURIComponent(igUserId) + '/media_publish', {
    creation_id: container.id,
    access_token: accessToken
  });

  return {mediaId: published.id || container.id, type: 'IMAGE'};
}

async function publishReel({videoUrl, caption}) {
  const igUserId = required('INSTAGRAM_USER_ID');
  const accessToken = required('INSTAGRAM_ACCESS_TOKEN');

  if (!/^https?:\/\//i.test(String(videoUrl || ''))) {
    throw new Error('URL ویدئو برای Instagram عمومی و معتبر نیست.');
  }

  const container = await graphPost('/' + encodeURIComponent(igUserId) + '/media', {
    media_type: 'REELS',
    video_url: videoUrl,
    caption: caption || '',
    access_token: accessToken
  });

  if (!container.id) throw new Error('Instagram Reel container ساخته نشد.');

  const maxWait = Number(process.env.INSTAGRAM_VIDEO_WAIT_SECONDS || 60);
  const started = Date.now();

  while (Date.now() - started < maxWait * 1000) {
    const statusUrl = GRAPH_BASE + '/' + encodeURIComponent(container.id) +
      '?fields=status_code&access_token=' + encodeURIComponent(accessToken);
    const response = await fetch(statusUrl);
    const text = await response.text();
    let status;
    try { status = JSON.parse(text); } catch { status = {}; }

    if (status.error) throw new Error('Instagram Reel status: ' + (status.error.message || 'unknown error'));
    if (status.status_code === 'FINISHED') break;
    if (status.status_code === 'ERROR') throw new Error('Instagram Reel پردازش نشد.');

    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  const published = await graphPost('/' + encodeURIComponent(igUserId) + '/media_publish', {
    creation_id: container.id,
    access_token: accessToken
  });

  return {mediaId: published.id || container.id, type: 'REEL'};
}

async function publishNews(item, caption) {
  if (!enabled()) return {skipped: true, reason: 'INSTAGRAM_ENABLED=false'};
  if (item.imageUrl) return publishImage({imageUrl: item.imageUrl, caption});
  if (item.videoUrl) return publishReel({videoUrl: item.videoUrl, caption});
  return {skipped: true, reason: 'خبر تصویر یا ویدئوی عمومی ندارد.'};
}

async function verifyInstagram() {
  const igUserId = required('INSTAGRAM_USER_ID');
  const accessToken = required('INSTAGRAM_ACCESS_TOKEN');
  const url = GRAPH_BASE + '/' + encodeURIComponent(igUserId) +
    '?fields=id,username,name&access_token=' + encodeURIComponent(accessToken);
  const response = await fetch(url);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!response.ok || data.error) {
    throw new Error('Instagram verification failed: ' + (data?.error?.message || ('HTTP ' + response.status)));
  }
  return data;
}

module.exports = {enabled, publishNews, verifyInstagram};
