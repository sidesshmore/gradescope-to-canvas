/**
 * Canvas course-file helpers for quiz figures. Runs on a Canvas page (same-origin,
 * the user's own session). Figures go into ONE hidden folder so students cannot
 * browse exam figures in Files, while quiz questions can still embed them.
 *
 * Files are named by content hash, so re-importing the same quiz reuses the
 * existing upload instead of piling up duplicates. Nothing is ever deleted.
 */
(function (root) {
  const FOLDER = 'gs2canvas-quiz-images';
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

  const csrf = () => { const m = document.cookie.match(/(?:^|; )_csrf_token=([^;]*)/); return m ? decodeURIComponent(m[1]) : ''; };

  async function api(method, path, body) {
    const res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf() },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw await (root.gs2canvasErrors ? root.gs2canvasErrors.httpError(method, path, res) : new Error(method + ' ' + path + ' -> ' + res.status));
    return res.status === 204 ? null : res.json();
  }

  async function sha256Hex(bytes) {
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Returns the hidden figures folder, creating it (hidden) only if it does not exist. */
  async function ensureFolder(courseId) {
    const folders = await api('GET', '/api/v1/courses/' + courseId + '/folders?per_page=100');
    const hit = folders.find((f) => f.name === FOLDER && f.full_name === 'course files/' + FOLDER);
    if (hit) return hit;
    return api('POST', '/api/v1/courses/' + courseId + '/folders', { name: FOLDER, parent_folder_path: '/', hidden: true });
  }

  async function findFile(folderId, name) {
    const files = await api('GET', '/api/v1/folders/' + folderId + '/files?per_page=100&search_term=' + encodeURIComponent(name));
    return files.find((f) => f.display_name === name || f.filename === name) || null;
  }

  /** Canvas 3-step upload. Resolves to the Canvas file object. */
  async function upload(courseId, folderId, name, type, bytes) {
    const step1 = await api('POST', '/api/v1/courses/' + courseId + '/files', {
      name, size: bytes.byteLength, content_type: type, parent_folder_id: folderId, on_duplicate: 'rename',
    });
    const fd = new FormData();
    Object.entries(step1.upload_params || {}).forEach(([k, v]) => fd.append(k, v));
    fd.append(step1.file_param || 'file', new Blob([bytes], { type }), name);
    const res = await fetch(step1.upload_url, { method: 'POST', body: fd });
    if (!res.ok && res.type !== 'opaqueredirect') throw new Error('upload to storage failed: ' + res.status);
    // The upload response differs between Canvas storage backends; ask Canvas itself what exists now.
    for (let i = 0; i < 10; i++) {
      const f = await findFile(folderId, name);
      if (f) return f;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('uploaded "' + name + '" but Canvas did not list it');
  }

  /**
   * img = { type, bytes: Uint8Array }. Returns { id, name, reused, url } where url is the
   * in-course preview link the importer embeds.
   */
  async function ensureImage(courseId, folder, img) {
    const hash = (await sha256Hex(img.bytes)).slice(0, 12);
    const name = 'gs2c-' + hash + '.' + (EXT[img.type] || 'png');
    const existing = await findFile(folder.id, name);
    const file = existing || await upload(courseId, folder.id, name, img.type, img.bytes);
    return { id: file.id, name, reused: !!existing, url: '/courses/' + courseId + '/files/' + file.id + '/preview' };
  }

  root.gs2canvasFiles = { FOLDER, ensureFolder, findFile, upload, ensureImage, sha256Hex };
})(typeof window !== 'undefined' ? window : globalThis);
