/**
 * Plain-language failure messages and the text behind "Copy diagnostics".
 * Diagnostics describe the page and the step that failed. They never contain quiz content,
 * and numeric ids in addresses are masked.
 */
(function (root) {
  // Canvas error bodies come in several shapes: a string, a list of {message}, or {field: [messages]}.
  const flat = (e) => {
    if (e == null) return '';
    if (Array.isArray(e)) return e.map((x) => (x && x.message) || flat(x)).filter(Boolean).join('; ');
    if (typeof e === 'object') return Object.entries(e).map(([k, v]) => (flat(v) ? k + ': ' + flat(v) : '')).filter(Boolean).join('; ');
    return String(e);
  };

  /** An HTTP failure from Canvas, with enough detail to explain it. */
  async function httpError(method, path, res) {
    let detail = '';
    try {
      const body = await res.json();
      detail = flat(body && (body.errors || body.message || body.error));
    } catch (_) { /* no JSON body */ }
    const err = new Error(method + ' ' + path + ' -> ' + res.status);
    err.status = res.status; err.method = method; err.path = path; err.detail = detail.slice(0, 300);
    return err;
  }

  const maskPath = (p) => String(p || '').split('?')[0].replace(/\/\d+(?=\/|$)/g, '/#');

  /** { title, message, hint } for any error thrown by this extension or by fetch. */
  function explain(err) {
    const e = err || {};
    const s = e.status;
    if (s === 401) return { title: 'You’re signed out of Canvas', message: 'Canvas didn’t recognise your session.', hint: 'Sign in again in this tab, then try again.' };
    if (s === 403) return { title: 'Canvas said no', message: 'You may not have permission to change this quiz or question bank, or the quiz is locked.', hint: 'Check that you can edit the quiz by hand, then try again.' };
    if (s === 404) return { title: 'Canvas couldn’t find it', message: 'The quiz, bank or question may have been deleted or moved.', hint: 'Reload the page and try again.' };
    if (s === 422) return { title: 'Canvas rejected a question', message: 'Canvas didn’t accept the data for one question' + (e.detail ? ': ' + e.detail : '.'), hint: 'Untick that question and import the rest, then copy the diagnostics into a bug report.' };
    if (s === 429) return { title: 'Canvas is asking us to slow down', message: 'Too many requests in a short time.', hint: 'Wait a minute, then try again. Nothing is lost.' };
    if (s >= 500) return { title: 'Canvas had a problem', message: 'Canvas answered with an error (HTTP ' + s + ').', hint: 'Wait a few minutes and try again.' };
    if (e instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(String(e.message))) return { title: 'Couldn’t reach the site', message: 'The request didn’t get through.', hint: 'Check your connection and try again.' };
    if (e.kind === 'page') return { title: e.title || 'This page isn’t what the extension expects', message: String(e.message), hint: e.hint || 'Make sure you’re on the right page. If you are, the page layout may have changed.' };
    return { title: 'Something went wrong', message: String(e.message || e), hint: 'Try again. If it keeps happening, copy the diagnostics into a bug report.' };
  }

  /** A short plain-text report the user can paste into an issue. */
  function diagnostics(opts) {
    opts = opts || {};
    const e = opts.error || {};
    const loc = typeof location !== 'undefined' ? location : { host: '', pathname: '' };
    let version = 'unknown';
    try { version = root.chrome.runtime.getManifest().version; } catch (_) { /* not in an extension */ }
    const lines = [
      'Gradescope to Canvas quiz copier: diagnostics',
      'Version: ' + version,
      'When: ' + new Date().toISOString(),
      'Page: ' + loc.host + ' ' + maskPath(loc.pathname),
      'Browser: ' + (typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'),
      'Step: ' + (opts.step || 'unknown'),
      'Error: ' + (e.status ? 'HTTP ' + e.status + ' ' + (e.method || '') + ' ' + maskPath(e.path) : String(e.message || e)),
    ];
    if (e.detail) lines.push('Canvas said: ' + e.detail);
    Object.entries(opts.extra || {}).forEach(([k, v]) => lines.push(k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v)));
    lines.push('(No quiz content is included.)');
    return lines.join('\n');
  }

  /** A page-structure problem on Gradescope, raised by the extractor. */
  function pageError(title, message, hint) {
    const err = new Error(message); err.kind = 'page'; err.title = title; err.hint = hint; return err;
  }

  root.gs2canvasErrors = { httpError, explain, diagnostics, maskPath, pageError };
})(typeof window !== 'undefined' ? window : globalThis);
