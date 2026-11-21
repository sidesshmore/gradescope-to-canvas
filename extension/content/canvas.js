// Canvas quiz edit page: adds an "Import from Gradescope" tab. Shows a preview of the questions
// copied from one or more Gradescope quizzes, then uploads figures (hidden folder), creates the
// questions and fixes their order.
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

  shadow.append(ui.launcher('Copy or import', openHub));

  const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  // A short generic instruction ("Read each question carefully...") is noise when repeated on
  // every question; a scenario or schema (long, or with a figure) must be repeated.
  const defaultRepeat = (g) => g.prompt.length >= 120 || /\[\[image:/.test(g.prompt);
  const answerLetters = (q) => q.choices.map((c, i) => (c.correct ? 'ABCDEFGHIJ'[i] : '')).filter(Boolean);
  const isOk = (q) => !!q.raw || q.type === 'multiple_choice' || q.type === 'multiple_answers';
  const countLeaves = (quiz) => leavesOf(quiz).length;
  const leavesOf = (quiz) => quiz.sections.flatMap((s) => (s.type === 'group' ? s.children : [s]));
  const when = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const closeButton = (label, primary) => button(label || 'Close', { variant: primary ? 'primary' : undefined, onclick: dlg.close });

  // Start screen: import what has been copied, or copy this quiz's questions.
  async function openHub() {
    let basket = null;
    try { basket = (await chrome.storage.local.get('basket')).basket; } catch (e) { /* treated as empty */ }
    const sources = (basket && basket.sources) || [];
    const n = sources.reduce((a, x) => a + countLeaves(x.quiz), 0);
    const choice = (title, text, onclick, disabled) => h('button', { class: 'choice', type: 'button', onclick, ...(disabled ? { disabled: true } : {}) }, h('span', { class: 't' }, title), h('span', { class: 'q' }, text));
    dlg.render({
      title: 'Copy or import',
      body: [
        choice('Import into this quiz', n ? plural(n, 'question') + ' copied from ' + plural(sources.length, 'quiz', 'quizzes') + ' are waiting.' : 'Nothing has been copied yet. Copy from Gradescope or from another Canvas quiz first.', openPanel, !n),
        choice('Copy from this quiz', 'Choose questions in this quiz to paste into another Canvas quiz.', copyFromHere),
      ],
      actions: [closeButton('Close')],
    });
  }

  async function copyFromHere() {
    dlg.render({ title: 'Copy from this quiz', body: [h('p', { class: 'muted' }, 'Reading this quiz’s questions…')], locked: true });
    let questions;
    try { questions = await window.gs2canvas.listQuestions(ids.courseId, ids.quizId); }
    catch (e) { return dlg.render({ title: 'Couldn’t read this quiz', body: [notice('err', String((e && e.message) || e))], actions: [closeButton('Close', true)] }); }
    const titleEl = document.querySelector('#quiz_title');
    const title = ((titleEl && titleEl.value) || '').trim() || 'Canvas quiz ' + ids.quizId;
    const src = window.gs2canvasSource.fromCanvas(questions, { title, courseId: ids.courseId, quizId: ids.quizId, url: location.origin + location.pathname.replace(/\/edit.*/, '') });
    const leaves = src.quiz.sections;
    if (!leaves.length) {
      return dlg.render({ title: 'This quiz has no questions', body: [h('p', {}, 'Add or import questions first, then copy them from here.')], actions: [closeButton('Close', true)] });
    }
    let basket = null;
    try { basket = (await chrome.storage.local.get('basket')).basket; } catch (e) { /* treated as empty */ }
    const sources = (basket && basket.sources) || [];
    const picks = [];
    const rows = leaves.map((q) => {
      const ok = isOk(q);
      let box = null;
      if (ok) { box = h('input', { type: 'checkbox', 'aria-label': 'Copy question ' + q.number, checked: true }); picks.push({ q, el: box }); box.addEventListener('change', refresh); }
      return h('tr', {},
        h('td', { class: 'pick' }, box),
        h('td', {}, q.number, ' ', h('span', { class: 'muted' }, q.excerpt)),
        h('td', {}, q.answerChips ? q.answerChips.map((l, i) => [i ? ' ' : null, h('span', { class: 'ans' }, l)]) : h('span', { class: 'muted' }, ok ? q.answerText : '')),
        h('td', { class: 'num' }, q.points == null ? '' : String(q.points)),
        h('td', {}, ok ? h('span', { class: 'muted' }, q.includes) : h('span', { class: 'flag-err' }, 'Can’t be copied')));
    });
    const countEl = h('span', { class: 'muted small' }, '');
    const allBox = h('input', { type: 'checkbox', 'aria-label': 'Select all questions', checked: true });
    const copyBtn = button('', { variant: 'primary', onclick: () => store() });
    function refresh() {
      const n = picks.filter((p) => p.el.checked).length;
      countEl.textContent = n + ' of ' + picks.length + ' selected';
      copyBtn.disabled = n === 0;
      copyBtn.textContent = n === 0 ? 'Select questions to copy' : 'Copy ' + plural(n, 'question');
      allBox.checked = n === picks.length; allBox.indeterminate = n > 0 && n < picks.length;
    }
    allBox.addEventListener('change', () => { picks.forEach((p) => { p.el.checked = allBox.checked; }); refresh(); });
    refresh();

    async function store() {
      const keep = new Set(picks.filter((p) => p.el.checked).map((p) => p.q.number));
      const mine = Object.assign({}, src, { quiz: Object.assign({}, src.quiz, { sections: leaves.filter((q) => keep.has(q.number)) }) });
      const next = sources.some((x) => x.id === mine.id) ? sources.map((x) => (x.id === mine.id ? mine : x)) : sources.concat(mine);
      try { await chrome.storage.local.set({ basket: { version: 2, sources: next } }); }
      catch (e) { return dlg.render({ title: 'Couldn’t save the copy', body: [notice('err', String((e && e.message) || e))], actions: [closeButton('Close', true)] }); }
      const total = next.reduce((a, x) => a + countLeaves(x.quiz), 0);
      dlg.render({
        title: 'Questions copied', subtitle: title,
        body: [h('p', { class: 'lead' }, h('b', {}, String(keep.size)), ' ' + (keep.size === 1 ? 'question' : 'questions') + ' copied from this quiz.'),
          h('p', {}, (next.length > 1 ? 'Your copy now holds ' + plural(total, 'question') + ' from ' + next.length + ' quizzes. ' : '') + 'Open the other quiz’s Edit page and choose ', h('b', {}, 'Copy or import'), ', then ', h('b', {}, 'Import into this quiz'), '.')],
        actions: [closeButton('Done', true)],
      });
    }
    dlg.render({
      title: 'Copy from this quiz', subtitle: title,
      body: [h('div', {}, h('div', { class: 'qhead' }, h('h3', {}, 'Questions'), countEl),
        h('div', { class: 'tablewrap tall' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { class: 'pick' }, allBox), h('th', {}, 'Question'), h('th', {}, 'Answer'), h('th', { class: 'num' }, 'Points'), h('th', {}, 'Includes'))), h('tbody', {}, rows))))],
      actions: [button('Back', { onclick: openHub }), copyBtn],
    });
  }

  async function openPanel() {
    dlg.render({ title: 'Import from Gradescope', body: [h('p', { class: 'muted' }, 'Checking this quiz…')], locked: true });

    const { basket } = await chrome.storage.local.get('basket');
    const sources = ((basket && basket.sources) || []).filter((s) => leavesOf(s.quiz).length);
    if (!sources.length) {
      return dlg.render({
        title: 'Nothing to import yet',
        body: [h('p', {}, 'Copy questions from a Gradescope rubric page (', h('b', {}, 'Copy quiz for Canvas'), ') or from another Canvas quiz (', h('b', {}, 'Copy from this quiz'), '), then come back here.')],
        actions: [closeButton('Close', true)],
      });
    }
    // Each source gets a name prefix so question numbers from different quizzes never collide in Canvas.
    const tags = [];
    sources.forEach((s) => {
      let tag = (s.title || 'Quiz ' + s.id).slice(0, 28).trim();
      if (tags.includes(tag)) tag += ' #' + s.id;
      tags.push(tag);
    });
    sources.forEach((s, i) => { s.prefix = tags[i] + ': '; });

    const reports = sources.map((s) => window.gs2canvasValidate.validateQuiz(s.quiz, { subset: true }));
    const blockers = [];
    reports.forEach((r, i) => r.warnings.filter((w) => w.level === 'error').forEach((w) => blockers.push(sources[i].title + ': ' + w.text)));
    if (blockers.length) {
      return dlg.render({ title: 'This copy has problems', body: blockers.map((t) => notice('err', t)), actions: [closeButton('Close', true)] });
    }
    const report = {
      supported: reports.reduce((a, r) => a + r.supported, 0), points: reports.reduce((a, r) => a + r.points, 0),
      images: reports.reduce((a, r) => a + r.images, 0), equations: reports.reduce((a, r) => a + r.equations, 0),
      warnings: reports.flatMap((r, i) => r.warnings.map((w) => ({ level: w.level, text: (sources.length > 1 ? sources[i].title + ': ' : '') + w.text }))),
    };
    report.images = sources.reduce((a, s) => a + s.images.length, 0);

    sources.forEach((x) => { if ((x.fileCourses || []).some((c) => c !== ids.courseId)) report.warnings.push({ level: 'warn', text: (x.title || 'A copied quiz') + ': some figures are stored in another course, so they won’t show in this one.' }); });

    let existing;
    try { existing = await window.gs2canvas.listQuestions(ids.courseId, ids.quizId); }
    catch (e) {
      return dlg.render({ title: 'Couldn’t read this quiz', body: [notice('err', String((e && e.message) || e))], actions: [closeButton('Close', true)] });
    }
    const preview = sources.flatMap((s) => window.gs2canvas.plan(s.quiz, { namePrefix: s.prefix }));
    const incoming = new Set(preview.map((p) => p.number));
    const existingNames = new Set(existing.map((q) => q.question_name));
    const clash = existing.filter((q) => incoming.has(q.question_name)).length;
    const otherQuestions = existing.length - clash; // questions in the quiz that this import does not own

    // --- shared text options (one per group, per quiz) --------------------------
    const ctxBoxes = [];
    sources.forEach((s, si) => s.quiz.sections.filter((g) => g.type === 'group' && g.prompt).forEach((g) => {
      ctxBoxes.push({ si, g, el: h('input', { type: 'checkbox', ...(defaultRepeat(g) ? { checked: true } : {}) }) });
    }));

    // --- preview table: one checkbox per question decides what gets imported -----
    // New questions start ticked. A question that already exists starts unticked; ticking it
    // means "replace it". Questions that can't be copied have no checkbox.
    const rows = [];
    const picks = []; // { si, number, name, clash, el, status }
    const countEl = h('span', { class: 'muted small' }, '');
    const importBtn = button('', { variant: 'primary', onclick: () => run() });
    const refresh = () => {
      const on = picks.filter((p) => p.el.checked);
      const n = on.length, r = on.filter((p) => p.clash).length;
      countEl.textContent = n + ' of ' + picks.length + ' selected';
      importBtn.disabled = n === 0;
      importBtn.textContent = n === 0 ? 'Select questions to import'
        : r === 0 ? 'Import ' + plural(n, 'question')
        : r === n ? 'Replace ' + plural(n, 'question')
        : 'Import ' + (n - r) + ', replace ' + r;
      picks.forEach((p) => { p.status.textContent = !p.clash ? 'New' : p.el.checked ? 'Will be replaced' : 'Already in quiz'; p.status.className = !p.clash ? 'muted' : 'flag-warn'; });
    };
    sources.forEach((src, si) => {
      const leaves = leavesOf(src.quiz);
      rows.push(h('tr', { class: 'grp' },
        h('td', { colspan: 6 }, h('span', { class: 'srcname' }, src.title || 'Quiz ' + src.id), ' ',
          h('span', { class: 'muted' }, plural(leaves.length, 'question') + ', copied ' + when(src.capturedAt)), ' ',
          h('button', { class: 'linkbtn', type: 'button', onclick: () => removeSource(src.id) }, 'Remove'))));
      leaves.forEach((q) => {
        const ok = isOk(q);
        const name = src.prefix + q.number;
        const text = JSON.stringify([q.prompt, q.choices]);
        const includes = q.raw ? q.includes : [/\[\[image:/.test(text) ? 'figure' : '', /\\\\\(/.test(text) ? 'math' : '', /```/.test(text) ? 'code' : ''].filter(Boolean).join(', ');
        const isClash = ok && existingNames.has(name);
        let box = null, status;
        if (ok) {
          box = h('input', { type: 'checkbox', 'aria-label': 'Import question ' + q.number, ...(isClash ? {} : { checked: true }) });
          status = h('span', {}, '');
          picks.push({ si, number: q.number, name, clash: isClash, el: box, status });
          box.addEventListener('change', refresh);
        } else status = h('span', { class: 'flag-err' }, 'Not copied');
        rows.push(h('tr', {},
          h('td', { class: 'pick' }, box),
          h('td', { class: 'indent' }, q.number, q.excerpt ? [' ', h('span', { class: 'muted' }, q.excerpt)] : null),
          h('td', {}, q.raw ? (q.answerChips ? q.answerChips.map((l, i) => [i ? ' ' : null, h('span', { class: 'ans' }, l)]) : h('span', { class: 'muted' }, q.answerText)) : answerLetters(q).map((l, i) => [i ? ' ' : null, h('span', { class: 'ans' }, l)])),
          h('td', { class: 'num' }, q.points == null ? '' : String(q.points)),
          h('td', { class: 'muted' }, includes),
          h('td', {}, status)));
      });
    });
    const allBox = h('input', { type: 'checkbox', 'aria-label': 'Select all new questions', checked: true });
    allBox.addEventListener('change', () => { picks.filter((p) => !p.clash).forEach((p) => { p.el.checked = allBox.checked; }); refresh(); });

    async function removeSource(id) {
      await chrome.storage.local.set({ basket: { version: 2, sources: sources.filter((s) => s.id !== id).map(({ prefix, ...rest }) => rest) } });
      openPanel();
    }

    function existingNote() {
      if (!clash) return 'This quiz already has ' + plural(existing.length, 'question') + '. None share a name with the incoming ones, so the new questions are added after them. Nothing is deleted.';
      if (clash === preview.length && existing.length === clash) return 'This quiz already contains all ' + preview.length + ' of these questions. They’re left alone unless you tick them in the table to replace them. Nothing is deleted.';
      return 'This quiz already has ' + plural(existing.length, 'question') + '. ' + plural(clash, 'has a name that matches', 'have names that match') + ' an incoming question and ' + (clash === 1 ? 'is' : 'are') + ' left alone unless you tick ' + (clash === 1 ? 'it' : 'them') + ' in the table to replace. Nothing is deleted.';
    }
    const previewBody = [
      summary({ supported: preview.length, points: report.points, images: report.images, equations: report.equations }),
      sources.length > 1 ? h('p', { class: 'muted small' }, 'From ' + sources.length + ' Gradescope quizzes, in the order they were copied.') : null,
      ...report.warnings.map((w) => notice('warn', w.text)),
      existing.length ? notice('info', existingNote()) : null,
      ctxBoxes.length ? h('div', {},
        h('h3', {}, 'Shared text'),
        h('p', { class: 'muted small' }, 'Canvas has no shared-text block, so text that belongs to a whole section can be copied onto each of its questions.'),
        ...ctxBoxes.map(({ si, g, el }) => h('label', { class: 'opt' }, el, h('span', {},
          h('span', { class: 't' }, 'Repeat ' + (sources.length > 1 ? sources[si].title + ' ' : '') + g.number + (g.title ? ' (' + g.title + ')' : '') + ' text on its ' + plural(g.children.length, 'question')),
          h('span', { class: 'q' }, g.prompt.replace(/\s+/g, ' ')))))) : null,
      h('div', {}, h('div', { class: 'qhead' }, h('h3', {}, 'Questions'), countEl),
        h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { class: 'pick' }, allBox), h('th', {}, 'Question'), h('th', {}, 'Answer'), h('th', { class: 'num' }, 'Points'), h('th', {}, 'Includes'), h('th', {}, 'Status'))), h('tbody', {}, rows)))),
      h('p', { class: 'muted small' }, 'Figures are stored in a hidden course folder (' + window.gs2canvasFiles.FOLDER + '). The quiz title, settings and publishing aren’t changed.'),
    ];
    refresh();
    dlg.render({
      title: 'Import from Gradescope',
      body: previewBody,
      actions: [closeButton('Cancel'), importBtn],
    });

    async function run() {
      const bar = h('i', {});
      const label = h('p', { class: 'muted' }, 'Starting…');
      const setProgress = (text, frac) => { label.textContent = text; bar.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%'; };
      dlg.render({ title: 'Importing', subtitle: 'Keep this tab open until it finishes.', body: [h('div', { class: 'progress' }, h('div', { class: 'bar' }, bar), label)], locked: true });

      try {
        const chosen = picks.filter((p) => p.el.checked);
        const perSource = sources.map((src, si) => {
          const mine = chosen.filter((p) => p.si === si);
          const only = mine.map((p) => p.number);
          const skipContextFor = ctxBoxes.filter((c) => c.si === si && !c.el.checked).map((c) => c.g.number);
          // Upload only the figures the chosen questions actually use.
          const used = window.gs2canvasValidate.imagesUsed(src.quiz, only, skipContextFor);
          return { src, only, skipContextFor, needed: src.images.filter((im) => used.has(im.index)) };
        });
        const nNeeded = perSource.reduce((a, p) => a + p.needed.length, 0);
        const total = nNeeded + chosen.length + 1;
        let done = 0;
        // 1. figures
        let folder = null;
        for (const p of perSource) {
          p.imageUrls = {};
          for (const im of p.needed) {
            if (!folder) { setProgress('Preparing the hidden figures folder', 0); folder = await window.gs2canvasFiles.ensureFolder(ids.courseId); }
            setProgress('Uploading figure ' + (done + 1) + ' of ' + nNeeded, done / total);
            const r = await window.gs2canvasFiles.ensureImage(ids.courseId, folder, { type: im.type, bytes: b64ToBytes(im.base64) });
            p.imageUrls[im.index] = r.url;
            done++;
          }
        }
        // 2. questions, quiz by quiz, in the order they were copied
        const planned = [];
        perSource.forEach((p) => {
          if (!p.only.length) return;
          planned.push(...window.gs2canvas.plan(p.src.quiz, { only: p.only, skipContextFor: p.skipContextFor, imageUrls: p.imageUrls, namePrefix: p.src.prefix, positionOffset: planned.length }));
        });
        let saved = 0;
        const result = await window.gs2canvas.sync(planned, ids, {
          update: chosen.filter((p) => p.clash).map((p) => p.name),
          onProgress: (n) => { saved++; setProgress('Saving ' + n + ' (' + saved + ' of ' + planned.length + ')', (done + saved) / total); },
        });
        // 3. order. Only when the quiz holds nothing but questions from this import: otherwise moving
        // ours around would disturb the user's own ordering.
        let orderNote = null;
        if (otherQuestions > 0) {
          orderNote = 'This quiz already had ' + plural(otherQuestions, 'other question') + ', so new questions were added at the end and the order was left alone. Drag them into place on the Questions tab if needed.';
        } else {
          setProgress('Putting the questions in order', (total - 1) / total);
          const present = new Set(existingNames); chosen.forEach((p) => present.add(p.name));
          try { await window.gs2canvas.reorder(preview.map((p) => p.number).filter((n) => present.has(n)), ids); }
          catch (e) { orderNote = 'The questions were created but couldn’t be put in order automatically (' + ((e && e.message) || e) + '). Drag them into order on the Questions tab.'; }
        }
        setProgress('Done', 1);

        dlg.render({
          title: 'Import finished',
          body: [
            h('p', { class: 'lead' }, h('b', {}, String(result.created.length)), ' created, ', h('b', {}, String(result.updated.length)), ' replaced, ', h('b', {}, String(result.skipped.length)), ' left alone.'),
            orderNote ? notice('warn', orderNote) : null,
            h('p', {}, 'Reload the page to see the questions in the editor. Then set the quiz title and settings, and publish when you’re ready.'),
          ],
          actions: [
            button('Clear copied questions', { onclick: async () => { await chrome.storage.local.remove('basket'); dlg.close(); } }),
            closeButton('Close'), button('Reload page', { variant: 'primary', onclick: () => location.reload() })],
        });
      } catch (e) {
        dlg.render({
          title: 'Import stopped',
          body: [notice('err', String((e && e.message) || e)), h('p', { class: 'muted' }, 'Questions that were already created are kept, and trying again skips them.')],
          actions: [closeButton('Close'), button('Try again', { variant: 'primary', onclick: () => run() })],
        });
      }
    }
  }
})();
