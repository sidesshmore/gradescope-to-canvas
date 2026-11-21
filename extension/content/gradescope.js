// Gradescope rubric page: adds a "Copy quiz for Canvas" tab. You choose which questions to copy;
// they go into a basket in chrome.storage.local (questions, key, points, math, figure bytes).
// Copy from several quizzes and the Canvas page imports them all into one quiz.
// Nothing leaves the browser.
(() => {
  const ui = window.gs2canvasUI;
  const { h, mount, notice, button, summary, plural } = ui;
  const { shadow } = mount('gs2canvas-gradescope');
  const dlg = ui.dialog(shadow);

  shadow.append(ui.launcher('Copy quiz for Canvas', capture));

  const working = (detail) => dlg.render({ title: 'Copying questions', body: [h('p', { class: 'muted' }, detail)], locked: true });
  const closeButton = (label, primary) => button(label || 'Close', { variant: primary === false ? undefined : 'primary', onclick: dlg.close });
  const isOk = (q) => q.type === 'multiple_choice' || q.type === 'multiple_answers';
  const answerLetters = (q) => q.choices.map((c, i) => (c.correct ? 'ABCDEFGHIJ'[i] : '')).filter(Boolean);

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

  // Keep only the chosen questions; a group stays only if one of its questions is chosen.
  // Group and total points describe the whole quiz, so they are dropped from the copy.
  function filterQuiz(quiz, numbers) {
    const sections = [];
    quiz.sections.forEach((s) => {
      if (s.type === 'group') {
        const children = s.children.filter((c) => numbers.has(c.number));
        if (children.length) sections.push(Object.assign({}, s, { points: null, children }));
      } else if (numbers.has(s.number)) sections.push(s);
    });
    return Object.assign({}, quiz, { totalPoints: null, sections });
  }

  async function capture() {
    working('Reading the questions on this page.');
    let quiz;
    try { quiz = window.extractGradescopeQuiz(document); }
    catch (e) {
      return dlg.render({ title: 'Couldn’t read this page', body: [notice('err', String((e && e.message) || e)), h('p', { class: 'muted' }, 'Make sure you’re on the assignment’s rubric page.')], actions: [closeButton()] });
    }
    const sourceId = (location.pathname.match(/assignments\/(\d+)/) || [])[1] || 'unknown';
    const title = quiz.title || ('Quiz ' + sourceId);
    let basket;
    try { basket = (await chrome.storage.local.get('basket')).basket; } catch (e) { basket = null; }
    const sources = (basket && basket.sources) || [];
    choose(quiz, { id: sourceId, title }, sources);
  }

  // Step 1: pick questions.
  function choose(quiz, src, sources) {
    const earlier = sources.find((s) => s.id === src.id);
    const earlierNumbers = new Set();
    if (earlier) earlier.quiz.sections.forEach((s) => (s.type === 'group' ? s.children : [s]).forEach((q) => earlierNumbers.add(q.number)));

    const picks = [];            // { q, el }
    const groupBoxes = [];       // { kids: picks[], el }
    const rows = [];
    const countEl = h('span', { class: 'muted small' }, '');
    const allBox = h('input', { type: 'checkbox', 'aria-label': 'Select all questions' });
    const copyBtn = button('', { variant: 'primary', onclick: () => copy() });

    const refresh = () => {
      const n = picks.filter((p) => p.el.checked).length;
      countEl.textContent = n + ' of ' + picks.length + ' selected';
      copyBtn.disabled = n === 0;
      copyBtn.textContent = n === 0 ? 'Select questions to copy' : 'Copy ' + plural(n, 'question');
      groupBoxes.forEach((g) => { const on = g.kids.filter((k) => k.el.checked).length; g.el.checked = on === g.kids.length; g.el.indeterminate = on > 0 && on < g.kids.length; });
      allBox.checked = n === picks.length; allBox.indeterminate = n > 0 && n < picks.length;
    };

    const leafRow = (q, indent) => {
      const text = JSON.stringify([q.prompt, q.choices]);
      const includes = [/\[\[image:/.test(text) ? 'figure' : '', /\\\\\(/.test(text) ? 'math' : '', /```/.test(text) ? 'code' : ''].filter(Boolean).join(', ');
      let box = null; let pick = null;
      if (isOk(q)) {
        box = h('input', { type: 'checkbox', 'aria-label': 'Copy question ' + q.number, ...(!earlier || earlierNumbers.has(q.number) ? { checked: true } : {}) });
        box.addEventListener('change', refresh);
        pick = { q, el: box }; picks.push(pick);
      }
      rows.push(h('tr', {},
        h('td', { class: 'pick' }, box),
        h('td', { class: indent ? 'indent' : '' }, q.number),
        h('td', {}, isOk(q) ? answerLetters(q).map((l, i) => [i ? ' ' : null, h('span', { class: 'ans' }, l)]) : ''),
        h('td', { class: 'num' }, q.points == null ? '' : String(q.points)),
        h('td', { class: 'muted' }, isOk(q) ? includes : h('span', { class: 'flag-err' }, 'Can’t be copied'))));
      return pick;
    };

    quiz.sections.forEach((s) => {
      if (s.type !== 'group') { leafRow(s, false); return; }
      const gbox = h('input', { type: 'checkbox', 'aria-label': 'Copy all of ' + s.number });
      const g = { kids: [], el: gbox };
      rows.push(h('tr', { class: 'grp' },
        h('td', { class: 'pick' }, gbox),
        h('td', { colspan: 4 }, s.number + (s.title ? '  ' + s.title : ''), ' ', h('span', { class: 'muted' }, plural(s.children.length, 'question')))));
      s.children.forEach((c) => { const pk = leafRow(c, true); if (pk) g.kids.push(pk); });
      if (g.kids.length) {
        gbox.addEventListener('change', () => { g.kids.forEach((k) => { k.el.checked = gbox.checked; }); refresh(); });
        groupBoxes.push(g);
      } else gbox.disabled = true;
    });
    allBox.addEventListener('change', () => { picks.forEach((p) => { p.el.checked = allBox.checked; }); refresh(); });
    refresh();

    const others = sources.filter((s) => s.id !== src.id);
    const inBasket = others.reduce((a, s) => a + countLeaves(s.quiz), 0);

    async function copy() {
      const chosen = new Set(picks.filter((p) => p.el.checked).map((p) => p.q.number));
      const filtered = filterQuiz(quiz, chosen);
      const report = window.gs2canvasValidate.validateQuiz(filtered, { subset: true });
      if (report.blocking) {
        return dlg.render({
          title: 'Can’t copy these questions',
          body: [...report.warnings.map((w) => notice(w.level === 'error' ? 'err' : 'warn', w.text)), h('p', { class: 'muted' }, 'Untick the questions with errors, or fix them on Gradescope.')],
          actions: [button('Back', { onclick: () => choose(quiz, src, sources) })],
        });
      }
      // Figures: bytes are fetched by the background worker (the page itself is not allowed to read them).
      // Only the figures the chosen questions use are downloaded.
      const used = [...window.gs2canvasValidate.imagesUsed(filtered, [...chosen], [])].sort((a, b) => a - b);
      const images = [];
      for (let k = 0; k < used.length; k++) {
        working('Downloading figure ' + (k + 1) + ' of ' + used.length + '.');
        const r = await fetchImage(quiz.images[used[k]].src);
        if (r && r.ok) images.push({ index: used[k], type: r.type, base64: r.base64, bytes: r.bytes });
        else report.warnings.push({ level: 'warn', text: 'Figure ' + (used[k] + 1) + ' couldn’t be downloaded (' + ((r && r.error) || 'unknown error') + '). Questions that use it will show a placeholder.' });
      }

      // Temporary signed image URLs are only needed during the copy; do not keep them.
      const stored = Object.assign({}, filtered, { images: quiz.images.map((im) => ({ alt: im.alt })) });
      const entry = { id: src.id, title: src.title, url: quiz.source && quiz.source.url, capturedAt: new Date().toISOString(), quiz: stored, images };
      const next = sources.some((s) => s.id === src.id) ? sources.map((s) => (s.id === src.id ? entry : s)) : sources.concat(entry);
      try { await chrome.storage.local.set({ basket: { version: 2, sources: next } }); }
      catch (e) {
        return dlg.render({ title: 'Couldn’t save the copy', body: [notice('err', String((e && e.message) || e))], actions: [closeButton()] });
      }
      const total = next.reduce((a, s) => a + countLeaves(s.quiz), 0);
      dlg.render({
        title: 'Questions copied',
        subtitle: src.title,
        body: [
          summary(report),
          ...report.warnings.map((w) => notice('warn', w.text)),
          h('p', {}, next.length > 1
            ? 'Your copy now holds ' + plural(total, 'question') + ' from ' + next.length + ' quizzes. Copy from another quiz to add more, or open the Canvas quiz’s Edit page and choose '
            : 'Copy from another quiz to add more, or open the Canvas quiz’s Edit page and choose ',
          h('b', {}, 'Import from Gradescope'), '.'),
        ],
        actions: [
          button('Save backup file', { onclick: () => downloadJson({ sources: next.map((s) => ({ title: s.title, quiz: s.quiz })) }, 'gradescope-quiz.json') }),
          closeButton('Done'),
        ],
      });
    }

    dlg.render({
      title: 'Choose questions to copy',
      subtitle: src.title,
      body: [
        earlier ? notice('info', 'You copied ' + plural(countLeaves(earlier.quiz), 'question') + ' from this quiz earlier. Copying again replaces that selection.') : null,
        others.length ? notice('info', 'Your copy already holds ' + plural(inBasket, 'question') + ' from ' + plural(others.length, 'other quiz', 'other quizzes') + '. These are added to it.') : null,
        h('div', {}, h('div', { class: 'qhead' }, h('h3', {}, 'Questions'), countEl),
          h('div', { class: 'tablewrap tall' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { class: 'pick' }, allBox), h('th', {}, 'Question'), h('th', {}, 'Answer'), h('th', { class: 'num' }, 'Points'), h('th', {}, 'Includes'))), h('tbody', {}, rows)))),
      ],
      actions: [closeButton('Cancel', false), copyBtn],
    });
  }

  function countLeaves(quiz) {
    return quiz.sections.reduce((a, s) => a + (s.type === 'group' ? s.children.length : 1), 0);
  }
})();
