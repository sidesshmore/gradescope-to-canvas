// Service worker. Its only job: fetch figure bytes from Gradescope on behalf of the
// content script. Gradescope image URLs redirect to a signed S3 URL with no CORS
// headers, so a page cannot read them, but an extension with host permission can.

const ALLOWED = [
  /^https:\/\/www\.gradescope\.com\/files\//,
  /^https:\/\/[a-z0-9.-]*gradescope[a-z0-9.-]*\.s3[a-z0-9.-]*\.amazonaws\.com\//,
];

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function fetchImage(url) {
  if (!ALLOWED.some((re) => re.test(url))) throw new Error('refusing to fetch non-Gradescope URL');
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!type.startsWith('image/')) throw new Error('not an image: ' + type);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 8 * 1024 * 1024) throw new Error('image larger than 8 MB');
  return { type, base64: toBase64(buf), bytes: buf.byteLength };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'gs2canvas:fetchImage') return false;
  // Only our own content scripts on Gradescope pages may ask.
  if (!sender.tab || !/^https:\/\/www\.gradescope\.com\//.test(sender.tab.url || '')) {
    sendResponse({ ok: false, error: 'bad sender' });
    return false;
  }
  fetchImage(msg.url).then((r) => sendResponse({ ok: true, ...r })).catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
  return true; // async response
});
