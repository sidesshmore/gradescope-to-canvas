// Gradescope rubric page: adds a "Copy quiz for Canvas" tab. Captures the quiz (questions, key,
// points, math, figure bytes) into chrome.storage.local so the Canvas page can import it.
// Nothing leaves the browser.
(() => {
  const ui = window.gs2canvasUI;
  const { h, mount, notice, button, summary } = ui;
  const { shadow } = mount('gs2canvas-gradescope');
  const dlg = ui.dialog(shadow);

  shadow.append(ui.launcher('Copy quiz for Canvas', capture));

  const working = (detail) => dlg.render({ title: 'Copying quiz', body: [h('p', { class: 'muted' }, detail)], locked: true });
  const closeButton = (label) => button(label || 'Close', { variant: 'primary', onclick: dlg.close });

  function fetchImage(url) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'gs2canvas:fetchImage', url }, (r) => {
        resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r);
      });
    });
  }

  function downloadJson(obj, name) {
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })), download: name });
    shadow.append(a); a.click(); a.remove();
  }

  async function capture() {
    working('Reading the questions on this page.');
    let quiz;
    try { quiz = window.extractGradescopeQuiz(document); }
    catch (e) {
      return dlg.render({ title: 'Couldn’t read this page', body: [notice('err', String((e && e.message) || e)), h('p', { class: 'muted' }, 'Make sure you’re on the assignment’s rubric page.')], actions: [closeButton()] });
    }

    const report = window.gs2canvasValidate.validateQuiz(quiz);

    // Figures: bytes are fetched by the background worker (the page itself is not allowed to read them).
    const images = [];
    for (let i = 0; i < quiz.images.length; i++) {
      working('Downloading figure ' + (i + 1) + ' of ' + quiz.images.length + '.');
      const r = await fetchImage(quiz.images[i].src);
      if (r && r.ok) images.push({ index: i, type: r.type, base64: r.base64, bytes: r.bytes });
      else report.warnings.push({ level: 'warn', text: 'Figure ' + (i + 1) + ' couldn’t be downloaded (' + ((r && r.error) || 'unknown error') + '). Questions that use it will show a placeholder.' });
    }

    if (report.blocking) {
      return dlg.render({
        title: 'Nothing was copied',
        body: [...report.warnings.map((w) => notice(w.level === 'error' ? 'err' : 'warn', w.text)), h('p', { class: 'muted' }, 'Fix these on Gradescope, then copy again.')],
        actions: [closeButton()],
      });
    }

    // Temporary signed image URLs are only needed during capture; do not keep them.
    const stored = Object.assign({}, quiz, { images: quiz.images.map((im) => ({ alt: im.alt })) });
    const payload = { version: 1, capturedAt: new Date().toISOString(), source: quiz.source, quiz: stored, images };
    try { await chrome.storage.local.set({ capture: payload }); }
    catch (e) {
      return dlg.render({ title: 'Couldn’t save the copy', body: [notice('err', String((e && e.message) || e))], actions: [closeButton()] });
    }

    dlg.render({
      title: 'Quiz copied',
      body: [
        summary(report),
        ...report.warnings.map((w) => notice('warn', w.text)),
        h('p', {}, 'Next, open the quiz’s Edit page in Canvas and choose ', h('b', {}, 'Import from Gradescope'), '.'),
      ],
      actions: [
        button('Save backup file', { onclick: () => downloadJson({ quiz: stored, images: images.map((i) => ({ index: i.index, type: i.type, bytes: i.bytes })) }, 'gradescope-quiz.json') }),
        closeButton('Done'),
      ],
    });
  }
})();
