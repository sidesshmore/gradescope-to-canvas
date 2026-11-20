// Canvas quiz edit page: adds an "Import from Gradescope" tab. Shows a preview of what will be
// created, then uploads figures (hidden folder), creates the questions and fixes their order.
// Uses the user's own Canvas session; no API token. It never deletes anything, and it never
// touches the quiz title, settings or publish state.
(() => {
  const m = location.pathname.match(/\/courses\/(\d+)\/quizzes\/(\d+)\/edit/);
  if (!m) return;
  const ids = { courseId: Number(m[1]), quizId: Number(m[2]) };
  const ui = window.gs2canvasUI;
  const { h, mount, notice, button, summary, plural } = ui;
  const { shadow } = mount('gs2canvas-canvas');
  const dlg = ui.dialog(shadow);

  shadow.append(ui.launcher('Import from Gradescope', openPanel));

  const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  // A short generic instruction ("Read each question carefully...") is noise when repeated on
  // every question; a scenario or schema (long, or with a figure) must be repeated.
  const defaultRepeat = (g) => g.prompt.length >= 120 || /\[\[image:/.test(g.prompt);
  const answerLetters = (q) => q.choices.map((c, i) => (c.correct ? 'ABCDEFGHIJ'[i] : '')).filter(Boolean);
  const when = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const closeButton = (label, primary) => button(label || 'Close', { variant: primary ? 'primary' : undefined, onclick: dlg.close });

  async function openPanel() {
    dlg.render({ title: 'Import from Gradescope', body: [h('p', { class: 'muted' }, 'Checking this quiz…')], locked: true });

    const { capture } = await chrome.storage.local.get('capture');
    if (!capture) {
      return dlg.render({
        title: 'Nothing to import yet',
        body: [h('p', {}, 'Open the quiz’s rubric page on Gradescope and choose ', h('b', {}, 'Copy quiz for Canvas'), ', then come back here.')],
        actions: [closeButton('Close', true)],
      });
    }
    const quiz = capture.quiz;
    const report = window.gs2canvasValidate.validateQuiz(quiz);
    if (report.blocking) {
      return dlg.render({ title: 'This copy has problems', body: report.warnings.map((w) => notice(w.level === 'error' ? 'err' : 'warn', w.text)), actions: [closeButton('Close', true)] });
    }

    let existing;
    try { existing = await window.gs2canvas.listQuestions(ids.courseId, ids.quizId); }
    catch (e) {
      return dlg.render({ title: 'Couldn’t read this quiz', body: [notice('err', String((e && e.message) || e))], actions: [closeButton('Close', true)] });
    }
    const groups = quiz.sections.filter((s) => s.type === 'group' && s.prompt);
    const preview = window.gs2canvas.plan(quiz);
    const incoming = new Set(preview.map((p) => p.number));
    const existingNames = new Set(existing.map((q) => q.question_name));
    const clash = existing.filter((q) => incoming.has(q.question_name)).length;
    const otherQuestions = existing.length - clash; // questions in the quiz that this import does not own

    // --- options ---------------------------------------------------------------
    const ctxBoxes = groups.map((g) => ({
      g, el: h('input', { type: 'checkbox', ...(defaultRepeat(g) ? { checked: true } : {}) }),
    }));
    const overwrite = h('input', { type: 'checkbox' });

    // --- preview table ---------------------------------------------------------
    const rows = [];
    quiz.sections.forEach((s) => (s.type === 'group' ? s.children : [s]).forEach((q) => {
      const ok = q.type === 'multiple_choice' || q.type === 'multiple_answers';
      const text = JSON.stringify([q.prompt, q.choices]);
      const includes = [/\[\[image:/.test(text) ? 'figure' : '', /\\\\\(/.test(text) ? 'math' : '', /```/.test(text) ? 'code' : ''].filter(Boolean).join(', ');
      const status = !ok ? h('span', { class: 'flag-err' }, 'Not copied')
        : existingNames.has(q.number) ? h('span', { class: 'flag-warn' }, 'Already in quiz') : h('span', { class: 'muted' }, 'New');
      rows.push(h('tr', {},
        h('td', {}, q.number),
        h('td', {}, ok ? answerLetters(q).map((l, i) => [i ? ' ' : null, h('span', { class: 'ans' }, l)]) : ''),
        h('td', { class: 'num' }, q.points == null ? '' : String(q.points)),
        h('td', { class: 'muted' }, includes),
        h('td', {}, status)));
    }));

    const doImport = () => run();
    function existingNote() {
      if (!clash) return 'This quiz already has ' + plural(existing.length, 'question') + '. None share a name with the incoming ones, so the new questions are added after them. Nothing is deleted.';
      if (clash === preview.length && existing.length === clash) return 'This quiz already contains all ' + preview.length + ' of these questions. They’re left alone unless you choose to replace them. Nothing is deleted.';
      return 'This quiz already has ' + plural(existing.length, 'question') + '. ' + plural(clash, 'has a name that matches', 'have names that match') + ' an incoming question and ' + (clash === 1 ? 'is' : 'are') + ' left alone unless you choose to replace them. Nothing is deleted.';
    }
    const previewBody = [
      summary({ supported: preview.length, points: report.points, images: report.images, equations: report.equations }),
      ...report.warnings.map((w) => notice('warn', w.text)),
      existing.length ? notice('info', existingNote()) : null,
      groups.length ? h('div', {},
        h('h3', {}, 'Shared text'),
        h('p', { class: 'muted small' }, 'Canvas has no shared-text block, so text that belongs to a whole section can be copied onto each of its questions.'),
        ...ctxBoxes.map(({ g, el }) => h('label', { class: 'opt' }, el, h('span', {},
          h('span', { class: 't' }, 'Repeat ' + g.number + (g.title ? ' (' + g.title + ')' : '') + ' text on its ' + plural(g.children.length, 'question')),
          h('span', { class: 'q' }, g.prompt.replace(/\s+/g, ' '))))),
      ) : null,
      clash ? h('label', { class: 'opt' }, overwrite, h('span', {}, h('span', { class: 't' }, 'Replace the ' + plural(clash, 'question') + ' that already exist'),
        h('span', { class: 'q' }, 'Their text, answers and points are overwritten with the Gradescope version.'))) : null,
      h('div', {}, h('h3', {}, 'Questions'),
        h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Question'), h('th', {}, 'Answer'), h('th', { class: 'num' }, 'Points'), h('th', {}, 'Includes'), h('th', {}, 'Status'))), h('tbody', {}, rows)))),
      h('p', { class: 'muted small' }, 'Figures are stored in a hidden course folder (' + window.gs2canvasFiles.FOLDER + '). The quiz title, settings and publishing aren’t changed.'),
    ];

    // The main button says what will really happen: new questions only, or all of them if replacing.
    const importBtn = button('', { variant: 'primary', onclick: doImport });
    const syncButton = () => {
      const n = overwrite.checked ? preview.length : preview.length - clash;
      importBtn.disabled = n === 0;
      importBtn.textContent = n === 0 ? 'Nothing new to import' : (overwrite.checked && clash ? 'Import and replace ' : 'Import ') + plural(n, 'question');
    };
    overwrite.addEventListener('change', syncButton);
    syncButton();
    dlg.render({
      title: 'Import from Gradescope',
      subtitle: 'Copied ' + when(capture.capturedAt),
      body: previewBody,
      actions: [closeButton('Cancel'), importBtn],
    });

    async function run() {
      const bar = h('i', {});
      const label = h('p', { class: 'muted' }, 'Starting…');
      const setProgress = (text, frac) => { label.textContent = text; bar.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%'; };
      dlg.render({ title: 'Importing', subtitle: 'Keep this tab open until it finishes.', body: [h('div', { class: 'progress' }, h('div', { class: 'bar' }, bar), label)], locked: true });

      try {
        const total = capture.images.length + preview.length + 1;
        let done = 0;
        // 1. figures
        const imageUrls = {};
        if (capture.images.length) {
          setProgress('Preparing the hidden figures folder', 0);
          const folder = await window.gs2canvasFiles.ensureFolder(ids.courseId);
          for (const im of capture.images) {
            setProgress('Uploading figure ' + (im.index + 1) + ' of ' + capture.images.length, done / total);
            const r = await window.gs2canvasFiles.ensureImage(ids.courseId, folder, { type: im.type, bytes: b64ToBytes(im.base64) });
            imageUrls[im.index] = r.url;
            done++;
          }
        }
        // 2. questions
        const skipContextFor = ctxBoxes.filter(({ el }) => !el.checked).map(({ g }) => g.number);
        const planned = window.gs2canvas.plan(quiz, { skipContextFor, imageUrls });
        let saved = 0;
        const result = await window.gs2canvas.sync(planned, ids, {
          update: overwrite.checked ? planned.map((p) => p.number) : [],
          onProgress: (n) => { saved++; setProgress('Saving ' + n + ' (' + saved + ' of ' + planned.length + ')', (done + saved) / total); },
        });
        // 3. order. Only when the quiz holds nothing but the incoming questions: otherwise moving ours
        // around would disturb the user's own ordering.
        let orderNote = null;
        if (otherQuestions > 0) {
          orderNote = 'This quiz already had ' + plural(otherQuestions, 'other question') + ', so new questions were added at the end and the order was left alone. Drag them into place on the Questions tab if needed.';
        } else {
          setProgress('Putting the questions in order', (total - 1) / total);
          try { await window.gs2canvas.reorder(planned.map((p) => p.number), ids); }
          catch (e) { orderNote = 'The questions were created but couldn’t be put in order automatically (' + ((e && e.message) || e) + '). Drag them into order on the Questions tab.'; }
        }
        setProgress('Done', 1);

        dlg.render({
          title: 'Import finished',
          body: [
            h('p', { class: 'lead' }, h('b', {}, String(result.created.length)), ' created, ', h('b', {}, String(result.updated.length)), ' replaced, ', h('b', {}, String(result.skipped.length)), ' left alone.'),
            orderNote ? notice('warn', orderNote) : null,
            planned.skipped && planned.skipped.length ? notice('warn', plural(planned.skipped.length, 'question') + ' couldn’t be copied: ' + planned.skipped.map((s) => s.number).join(', ') + '.') : null,
            h('p', {}, 'Reload the page to see the questions in the editor. Then set the quiz title and settings, and publish when you’re ready.'),
          ],
          actions: [closeButton('Close'), button('Reload page', { variant: 'primary', onclick: () => location.reload() })],
        });
      } catch (e) {
        dlg.render({
          title: 'Import stopped',
          body: [notice('err', String((e && e.message) || e)), h('p', { class: 'muted' }, 'Questions that were already created are kept, and trying again skips them.')],
          actions: [closeButton('Close'), button('Try again', { variant: 'primary', onclick: doImport })],
        });
      }
    }
  }
})();
