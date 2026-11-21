// Canvas quiz edit page: adds a "Copy or import" tab.
//  - Copy questions from this quiz (to paste into another quiz or bank).
//  - Import what was copied (from Gradescope and/or other Canvas quizzes) into this quiz or into a
//    question bank, after a preview where you can choose, reorder, rename and re-point questions.
//  - Undo an import.
// Uses the user's own Canvas session; no API token. Imports never delete or overwrite anything
// unless you tick a question to be replaced, and never touch the quiz title, settings or publishing.
(() => {
  const m = location.pathname.match(/\/courses\/(\d+)\/quizzes\/(\d+)\/edit/);
  if (!m) return;
  const ids = { courseId: Number(m[1]), quizId: Number(m[2]) };
  const ui = window.gs2canvasUI;
  const { h, mount, notice, button, summary, plural } = ui;
  const G = window.gs2canvas;
  const { shadow } = mount('gs2canvas-canvas');
  const dlg = ui.dialog(shadow);
  const history = window.gs2canvasHistory.createHistory(chrome.storage.local);

  shadow.append(ui.launcher('Copy or import', openHub));

  // ---- small helpers ------------------------------------------------------------
  const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  // A short generic instruction ("Read each question carefully...") is noise when repeated on
  // every question; a scenario or schema (long, or with a figure) must be repeated.
  const defaultRepeat = (g) => g.prompt.length >= 120 || /\[\[image:/.test(g.prompt);
  const answerLetters = (q) => q.choices.map((c, i) => (c.correct ? 'ABCDEFGHIJ'[i] : '')).filter(Boolean);
  const isOk = (q) => !!q.raw || q.type === 'multiple_choice' || q.type === 'multiple_answers';
  const leavesOf = (quiz) => quiz.sections.flatMap((s) => (s.type === 'group' ? s.children : [s]));
  const countLeaves = (quiz) => leavesOf(quiz).length;
  const when = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const closeButton = (label, primary) => button(label || 'Close', { variant: primary ? 'primary' : undefined, onclick: dlg.close });
  const chips = (letters) => letters.map((l, i) => [i ? ' ' : null, h('span', { class: 'ans' }, l)]);
  const fail = (error, step, extra, actions) => dlg.render(ui.failureView({ error, step, extra, actions: actions || [closeButton('Close')] }));

  const getBasket = async () => {
    try { return ((await chrome.storage.local.get('basket')).basket || {}).sources || []; } catch (e) { return []; }
  };
  const putBasket = (sources) => chrome.storage.local.set({ basket: { version: 2, sources: sources.map(({ prefix, ...rest }) => rest) } });

  // Each source gets a name prefix so question numbers from different quizzes never collide.
  function assignPrefixes(sources) {
    const tags = [];
    sources.forEach((s) => {
      let tag = (s.title || 'Quiz ' + s.id).slice(0, 28).trim();
      if (tags.includes(tag)) tag += ' #' + s.id;
      tags.push(tag);
      s.prefix = tag + ': ';
    });
  }
  const orderedLeaves = (src) => {
    const all = leavesOf(src.quiz);
    if (!src.order) return all;
    const pos = new Map(src.order.map((n, i) => [n, i]));
    return all.slice().sort((a, b) => (pos.has(a.number) ? pos.get(a.number) : 1e9) - (pos.has(b.number) ? pos.get(b.number) : 1e9));
  };
  const pointsOf = (src, q) => (src.points && src.points[q.number] !== undefined ? src.points[q.number] : q.points);

  // ---- start screen ---------------------------------------------------------------
  async function openHub() {
    S = null;
    const sources = await getBasket();
    const n = sources.reduce((a, x) => a + countLeaves(x.quiz), 0);
    let undoable = [];
    try { undoable = await history.list(ids.courseId); } catch (e) { /* no history yet */ }
    const choice = (title, text, onclick, disabled) => h('button', { class: 'choice', type: 'button', onclick, ...(disabled ? { disabled: true } : {}) }, h('span', { class: 't' }, title), h('span', { class: 'q' }, text));
    dlg.render({
      title: 'Copy or import',
      body: [
        choice('Import into this quiz or a bank', n ? plural(n, 'question') + ' copied from ' + plural(sources.length, 'quiz', 'quizzes') + ' are waiting.' : 'Nothing has been copied yet. Copy from Gradescope or from another Canvas quiz first.', () => openPanel(), !n),
        choice('Copy from this quiz', 'Choose questions in this quiz to paste into another Canvas quiz or a bank.', copyFromHere),
        undoable.length ? choice('Undo an import', plural(undoable.length, 'recent import') + ' in this course can be undone.', openUndo) : null,
      ],
      actions: [closeButton('Close')],
    });
  }

  // ---- copy from this quiz -------------------------------------------------------
  async function copyFromHere() {
    dlg.render({ title: 'Copy from this quiz', body: [h('p', { class: 'muted' }, 'Reading this quiz’s questions…')], locked: true });
    let questions;
    try { questions = await G.listQuestions(ids.courseId, ids.quizId); }
    catch (e) { return fail(e, 'Reading this quiz’s questions'); }
    const titleEl = document.querySelector('#quiz_title');
    const title = ((titleEl && titleEl.value) || '').trim() || 'Canvas quiz ' + ids.quizId;
    const src = window.gs2canvasSource.fromCanvas(questions, { title, courseId: ids.courseId, quizId: ids.quizId, url: location.origin + location.pathname.replace(/\/edit.*/, '') });
    const leaves = src.quiz.sections;
    if (!leaves.length) {
      return dlg.render({ title: 'This quiz has no questions', body: [h('p', {}, 'Add or import questions first, then copy them from here.')], actions: [closeButton('Close', true)] });
    }
    const sources = await getBasket();
    const picks = [];
    const rows = leaves.map((q) => {
      const ok = isOk(q);
      let box = null;
      if (ok) { box = h('input', { type: 'checkbox', 'aria-label': 'Copy question ' + q.number, checked: true }); picks.push({ q, el: box }); box.addEventListener('change', refresh); }
      return h('tr', {},
        h('td', { class: 'pick' }, box),
        h('td', {}, q.number, ' ', h('span', { class: 'muted' }, q.excerpt)),
        h('td', {}, q.answerChips ? chips(q.answerChips) : h('span', { class: 'muted' }, ok ? q.answerText : '')),
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
      try { await putBasket(next); }
      catch (e) { return fail(e, 'Saving the copy in the browser'); }
      const total = next.reduce((a, x) => a + countLeaves(x.quiz), 0);
      dlg.render({
        title: 'Questions copied', subtitle: title,
        body: [h('p', { class: 'lead' }, h('b', {}, String(keep.size)), ' ' + (keep.size === 1 ? 'question' : 'questions') + ' copied from this quiz.'),
          h('p', {}, (next.length > 1 ? 'Your copy now holds ' + plural(total, 'question') + ' from ' + next.length + ' quizzes. ' : '') + 'Open the other quiz’s Edit page and choose ', h('b', {}, 'Copy or import'), ', then ', h('b', {}, 'Import into this quiz or a bank'), '.')],
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

  // ---- import: preview, edit, run ---------------------------------------------------
  // Everything the preview shows is derived from S, so editing (reorder, rename, points, destination)
  // is just "change S, render again". Ticks, edits and the destination survive each render.
  let S = null;

  async function openPanel() {
    dlg.render({ title: 'Import', body: [h('p', { class: 'muted' }, 'Checking what’s waiting…')], locked: true });
    const sources = (await getBasket()).filter((s) => leavesOf(s.quiz).length);
    if (!sources.length) {
      return dlg.render({
        title: 'Nothing to import yet',
        body: [h('p', {}, 'Copy questions from a Gradescope rubric page (', h('b', {}, 'Copy quiz for Canvas'), ') or from another Canvas quiz (', h('b', {}, 'Copy from this quiz'), '), then come back here.')],
        actions: [closeButton('Close', true)],
      });
    }
    assignPrefixes(sources);
    S = { sources, tick: new Map(), ctx: new Map(), renaming: null, banks: null, existing: null, dest: { mode: 'quiz', bankId: '__new', title: (sources[0].title || 'Imported questions') } };
    try { await loadExisting(); } catch (e) { return fail(e, 'Reading this quiz’s questions'); }
    render();
  }

  const targetOf = () => (S.dest.mode === 'bank' && S.dest.bankId !== '__new'
    ? G.bankTarget(ids.courseId, S.banks.find((b) => String(b.id) === String(S.dest.bankId)))
    : G.quizTarget(ids));

  async function loadExisting() {
    S.existing = (S.dest.mode === 'bank' && S.dest.bankId === '__new') ? [] : await targetOf().list();
  }

  async function changeDestination(mode, bankId) {
    S.dest.mode = mode; if (bankId !== undefined) S.dest.bankId = bankId;
    dlg.render({ title: 'Import', body: [h('p', { class: 'muted' }, 'Checking…')], locked: true });
    try {
      if (mode === 'bank' && !S.banks) {
        S.banks = await G.listBanks(ids.courseId);
        if (S.dest.bankId !== '__new' && !S.banks.some((b) => String(b.id) === String(S.dest.bankId))) S.dest.bankId = '__new';
      }
      await loadExisting();
    } catch (e) {
      S.dest.mode = 'quiz'; S.dest.bankId = '__new'; S.existing = null;
      return fail(e, 'Looking up question banks', {}, [button('Back', { variant: 'primary', onclick: async () => { try { await loadExisting(); render(); } catch (e2) { fail(e2, 'Reading this quiz’s questions'); } } })]);
    }
    render();
  }

  function render() {
    const { sources, dest } = S;
    const isBank = dest.mode === 'bank';
    const keyOf = (src, q) => src.id + '|' + q.number;
    const reports = sources.map((s) => window.gs2canvasValidate.validateQuiz(s.quiz, { subset: true }));
    const blockers = [];
    reports.forEach((r, i) => r.warnings.filter((w) => w.level === 'error').forEach((w) => blockers.push(sources[i].title + ': ' + w.text)));
    if (blockers.length) return dlg.render({ title: 'This copy has problems', body: blockers.map((t) => notice('err', t)), actions: [closeButton('Close', true)] });
    const warnings = reports.flatMap((r, i) => r.warnings.map((w) => ({ level: w.level, text: (sources.length > 1 ? sources[i].title + ': ' : '') + w.text })));
    sources.forEach((x) => { if ((x.fileCourses || []).some((c) => c !== ids.courseId)) warnings.push({ level: 'warn', text: (x.title || 'A copied quiz') + ': some figures are stored in another course, so they won’t show in this one.' }); });

    const existing = S.existing;
    const existingNames = new Set(existing.map((q) => q.question_name));
    // Names after the prefix; used to spot questions that are already at the destination.
    const allNames = sources.flatMap((s) => leavesOf(s.quiz).filter(isOk).map((q) => s.prefix + q.number));
    const incoming = new Set(allNames);
    const clash = existing.filter((q) => incoming.has(q.question_name)).length;
    const otherQuestions = existing.length - clash;

    // --- shared text options (one per group, per quiz) --------------------------
    const ctxBoxes = [];
    sources.forEach((s, si) => s.quiz.sections.filter((g) => g.type === 'group' && g.prompt).forEach((g) => {
      const k = s.id + '|' + g.number;
      const on = S.ctx.has(k) ? S.ctx.get(k) : defaultRepeat(g);
      const el = h('input', { type: 'checkbox', ...(on ? { checked: true } : {}) });
      el.addEventListener('change', () => S.ctx.set(k, el.checked));
      ctxBoxes.push({ si, g, el });
    }));

    // --- the table -----------------------------------------------------------------
    const rows = []; const picks = [];
    const countEl = h('span', { class: 'muted small' }, '');
    const importBtn = button('', { variant: 'primary', onclick: () => run() });
    const statusOf = (p) => (!p.clash ? 'New' : p.box.checked ? 'Will be replaced' : 'Already there');
    const refresh = () => {
      const on = picks.filter((p) => p.box.checked);
      const n = on.length, r = on.filter((p) => p.clash).length;
      const pts = on.reduce((a, p) => a + (Number(p.ptsEl.value) || 0), 0);
      countEl.textContent = n + ' of ' + picks.length + ' selected, ' + pts + (pts === 1 ? ' point' : ' points');
      importBtn.disabled = n === 0 || (isBank && dest.bankId === '__new' && !dest.title.trim());
      const dst = isBank ? ' to bank' : '';
      importBtn.textContent = n === 0 ? 'Select questions to import'
        : r === 0 ? (isBank ? 'Add ' + plural(n, 'question') + ' to bank' : 'Import ' + plural(n, 'question'))
        : r === n ? 'Replace ' + plural(n, 'question')
        : (isBank ? 'Add ' : 'Import ') + (n - r) + ', replace ' + r + dst;
      picks.forEach((p) => { p.status.textContent = statusOf(p); p.status.className = p.clash ? 'flag-warn' : 'muted'; });
    };
    const mover = (label, text, disabled, fn) => h('button', { class: 'mv', type: 'button', 'aria-label': label, title: label, onclick: fn, ...(disabled ? { disabled: true } : {}) }, text);
    const saveAnd = (fn) => async () => { fn(); try { await putBasket(sources); } catch (e) { /* edits still apply this session */ } render(); };

    sources.forEach((src, si) => {
      const leaves = orderedLeaves(src);
      let nameCell;
      if (S.renaming === src.id) {
        const input = h('input', { type: 'text', value: src.title || '', 'aria-label': 'Name for this quiz', maxlength: 60 });
        let finished = false;
        const commit = (keep) => {
          if (finished) return; finished = true;
          const v = input.value.trim();
          if (keep && v) { src.title = v; assignPrefixes(sources); putBasket(sources).catch(() => {}); }
          S.renaming = null; render();
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); });
        input.addEventListener('blur', () => commit(true));
        nameCell = [input];
        setTimeout(() => { input.focus(); input.select(); }, 0);
      } else nameCell = [h('span', { class: 'srcname' }, src.title || 'Quiz ' + src.id)];
      rows.push(h('tr', { class: 'grp' },
        h('td', { colspan: 7 }, ...nameCell, ' ',
          h('span', { class: 'muted' }, plural(leaves.length, 'question') + ', copied ' + when(src.capturedAt)), ' ',
          h('button', { class: 'linkbtn', type: 'button', onclick: () => { S.renaming = src.id; render(); } }, 'Rename'),
          h('button', { class: 'linkbtn', type: 'button', onclick: () => removeSource(src.id) }, 'Remove'),
          sources.length > 1 ? [mover('Move this quiz up', '↑', si === 0, saveAnd(() => { [sources[si - 1], sources[si]] = [sources[si], sources[si - 1]]; })),
            mover('Move this quiz down', '↓', si === sources.length - 1, saveAnd(() => { [sources[si + 1], sources[si]] = [sources[si], sources[si + 1]]; }))] : null)));
      leaves.forEach((q, qi) => {
        const ok = isOk(q);
        const name = src.prefix + q.number;
        const text = JSON.stringify([q.prompt, q.choices]);
        const includes = q.raw ? q.includes : [/\[\[image:/.test(text) ? 'figure' : '', /\\\\\(/.test(text) ? 'math' : '', /```/.test(text) ? 'code' : ''].filter(Boolean).join(', ');
        const isClash = ok && existingNames.has(name);
        let box = null, ptsEl = null, status;
        if (ok) {
          const k = keyOf(src, q);
          box = h('input', { type: 'checkbox', 'aria-label': 'Import question ' + q.number, ...((S.tick.has(k) ? S.tick.get(k) : !isClash) ? { checked: true } : {}) });
          ptsEl = h('input', { type: 'number', min: 0, step: 0.5, value: pointsOf(src, q) == null ? '' : pointsOf(src, q), 'aria-label': 'Points for question ' + q.number });
          status = h('span', {}, '');
          const pick = { src, q, key: k, name, clash: isClash, box, ptsEl, status };
          picks.push(pick);
          box.addEventListener('change', () => { S.tick.set(k, box.checked); refresh(); });
          ptsEl.addEventListener('change', () => {
            const v = Number(ptsEl.value);
            if (ptsEl.value === '' || !(v >= 0)) { ptsEl.value = pointsOf(src, q) == null ? '' : pointsOf(src, q); return; }
            src.points = Object.assign({}, src.points, { [q.number]: v }); putBasket(sources).catch(() => {}); refresh();
          });
        } else status = h('span', { class: 'flag-err' }, 'Not copied');
        rows.push(h('tr', {},
          h('td', { class: 'pick' }, box),
          h('td', { class: 'indent' }, q.number, q.excerpt ? [' ', h('span', { class: 'muted' }, q.excerpt)] : null),
          h('td', {}, ok ? (q.raw ? (q.answerChips ? chips(q.answerChips) : h('span', { class: 'muted' }, q.answerText)) : chips(answerLetters(q))) : ''),
          h('td', { class: 'num' }, ptsEl),
          h('td', { class: 'muted' }, includes),
          h('td', {}, status),
          h('td', { class: 'mvcell' }, isBank ? null : [mover('Move up', '↑', qi === 0, saveAnd(() => { const nums = leaves.map((x) => x.number); [nums[qi - 1], nums[qi]] = [nums[qi], nums[qi - 1]]; src.order = nums; })),
            mover('Move down', '↓', qi === leaves.length - 1, saveAnd(() => { const nums = leaves.map((x) => x.number); [nums[qi + 1], nums[qi]] = [nums[qi], nums[qi + 1]]; src.order = nums; }))])));
      });
    });
    const allBox = h('input', { type: 'checkbox', 'aria-label': 'Select all new questions', checked: picks.filter((p) => !p.clash).every((p) => p.box.checked) });
    allBox.addEventListener('change', () => { picks.filter((p) => !p.clash).forEach((p) => { p.box.checked = allBox.checked; S.tick.set(p.key, allBox.checked); }); refresh(); });

    // bulk points
    const bulk = h('input', { type: 'number', min: 0, step: 0.5, placeholder: 'pts', 'aria-label': 'Points to give every selected question' });
    const applyBulk = () => {
      const v = Number(bulk.value);
      if (bulk.value === '' || !(v >= 0)) return;
      picks.filter((p) => p.box.checked).forEach((p) => { p.ptsEl.value = v; p.src.points = Object.assign({}, p.src.points, { [p.q.number]: v }); });
      putBasket(sources).catch(() => {}); refresh();
    };

    async function removeSource(id) {
      const next = sources.filter((s) => s.id !== id);
      try { await putBasket(next); } catch (e) { return fail(e, 'Saving the copy in the browser'); }
      if (!next.length) return openHub();
      S.sources = next; render();
    }

    // destination
    const bankSel = isBank && S.banks ? h('select', { 'aria-label': 'Question bank', onchange: (e) => changeDestination('bank', e.target.value) },
      h('option', { value: '__new', ...(dest.bankId === '__new' ? { selected: true } : {}) }, 'New bank…'),
      ...S.banks.map((b) => h('option', { value: b.id, ...(String(b.id) === String(dest.bankId) ? { selected: true } : {}) }, b.title))) : null;
    const bankName = isBank && dest.bankId === '__new' ? h('input', { type: 'text', value: dest.title, placeholder: 'Name of the new bank', 'aria-label': 'Name of the new bank', maxlength: 100 }) : null;
    if (bankName) bankName.addEventListener('input', () => { dest.title = bankName.value; refresh(); });
    const radio = (mode, label, text) => {
      const el = h('input', { type: 'radio', name: 'gs2c-dest', ...(dest.mode === mode ? { checked: true } : {}) });
      el.addEventListener('change', () => { if (el.checked && dest.mode !== mode) changeDestination(mode); });
      return h('label', { class: 'opt' }, el, h('span', {}, h('span', { class: 't' }, label), h('span', { class: 'q' }, text)));
    };

    function existingNote() {
      if (!existing.length) return null;
      const at = isBank ? 'The bank' : 'This quiz';
      if (!clash) return at + ' already has ' + plural(existing.length, 'question') + '. None share a name with the incoming ones, so the new questions are added alongside them. Nothing is deleted.';
      if (clash === allNames.length && existing.length === clash) return at + ' already contains all ' + allNames.length + ' of these questions. They’re left alone unless you tick them in the table to replace them. Nothing is deleted.';
      return at + ' already has ' + plural(existing.length, 'question') + '. ' + plural(clash, 'has a name that matches', 'have names that match') + ' an incoming question and ' + (clash === 1 ? 'is' : 'are') + ' left alone unless you tick ' + (clash === 1 ? 'it' : 'them') + ' in the table to replace. Nothing is deleted.';
    }
    const totalPts = picks.reduce((a, p) => a + (Number(pointsOf(p.src, p.q)) || 0), 0);
    const body = [
      summary({ supported: picks.length, points: totalPts, images: sources.reduce((a, s) => a + s.images.length, 0), equations: reports.reduce((a, r) => a + r.equations, 0) }),
      sources.length > 1 ? h('p', { class: 'muted small' }, 'From ' + sources.length + ' quizzes, in the order shown. Use the arrows to change the order.') : null,
      ...warnings.map((w) => notice('warn', w.text)),
      h('div', { class: 'dest' }, h('h3', {}, 'Where to add them'),
        radio('quiz', 'This quiz', 'The questions go into the quiz you have open.'),
        radio('bank', 'A question bank', 'Banks keep the questions for reuse in other quizzes and terms. They aren’t ordered.'),
        isBank ? h('div', { class: 'fields' }, bankSel, bankName) : null),
      existingNote() ? notice('info', existingNote()) : null,
      ctxBoxes.length ? h('div', {},
        h('h3', {}, 'Shared text'),
        h('p', { class: 'muted small' }, 'Canvas has no shared-text block, so text that belongs to a whole section can be copied onto each of its questions.'),
        ...ctxBoxes.map(({ si, g, el }) => h('label', { class: 'opt' }, el, h('span', {},
          h('span', { class: 't' }, 'Repeat ' + (sources.length > 1 ? sources[si].title + ' ' : '') + g.number + (g.title ? ' (' + g.title + ')' : '') + ' text on its ' + plural(g.children.length, 'question')),
          h('span', { class: 'q' }, g.prompt.replace(/\s+/g, ' ')))))) : null,
      h('div', {}, h('div', { class: 'qhead' }, h('h3', {}, 'Questions'), countEl),
        h('div', { class: 'tools' }, 'Set the points of the selected questions to ', bulk, button('Apply', { onclick: applyBulk })),
        h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { class: 'pick' }, allBox), h('th', {}, 'Question'), h('th', {}, 'Answer'), h('th', { class: 'num' }, 'Points'), h('th', {}, 'Includes'), h('th', {}, 'Status'), h('th', {}, ''))), h('tbody', {}, rows)))),
      h('p', { class: 'muted small' }, 'Figures are stored in a hidden course folder (' + window.gs2canvasFiles.FOLDER + '). The quiz title, settings and publishing aren’t changed. You can undo this import afterwards from Copy or import.'),
    ];
    refresh();
    dlg.render({ title: 'Import', subtitle: isBank ? 'Into a question bank' : 'Into this quiz', body, actions: [button('Cancel', { onclick: dlg.close }), importBtn] });

    // ---- run -------------------------------------------------------------------------
    async function run() {
      const bar = h('i', {});
      const label = h('p', { class: 'muted' }, 'Starting…');
      let step = 'Starting';
      const setProgress = (text, frac) => { step = text; label.textContent = text; bar.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%'; };
      dlg.render({ title: 'Importing', subtitle: 'Keep this tab open until it finishes.', body: [h('div', { class: 'progress' }, h('div', { class: 'bar' }, bar), label)], locked: true });

      const chosen = picks.filter((p) => p.box.checked);
      const pointsFor = new Map(chosen.map((p) => [p.key, Number(p.ptsEl.value)]));
      const extra = { Destination: isBank ? 'bank' : 'quiz', 'Questions chosen': chosen.length };
      let histId = null; let created = 0;
      try {
        const perSource = sources.map((src, si) => {
          const mine = chosen.filter((p) => p.src === src);
          const only = mine.map((p) => p.q.number);
          const skipContextFor = ctxBoxes.filter((c) => c.si === si && !c.el.checked).map((c) => c.g.number);
          // Upload only the figures the chosen questions actually use.
          const used = window.gs2canvasValidate.imagesUsed(src.quiz, only, skipContextFor);
          return { src, only, skipContextFor, needed: src.images.filter((im) => used.has(im.index)), imageUrls: {} };
        });
        const nNeeded = perSource.reduce((a, p) => a + p.needed.length, 0);
        const total = nNeeded + chosen.length + 1;
        let done = 0;

        // 0. the destination (a new bank is created first)
        let target;
        let bankCreated = false;
        if (isBank && dest.bankId === '__new') {
          setProgress('Creating the bank', 0);
          const b = await G.createBank(ids.courseId, dest.title.trim());
          bankCreated = true; target = G.bankTarget(ids.courseId, b);
        } else target = targetOf();
        histId = history.start(isBank ? { kind: 'bank', courseId: ids.courseId, bankId: target.bank.id, bankTitle: target.bank.title, bankCreated } : { kind: 'quiz', courseId: ids.courseId, quizId: ids.quizId });

        // 1. figures
        let folder = null;
        for (const p of perSource) {
          for (const im of p.needed) {
            if (!folder) { setProgress('Preparing the hidden figures folder', 0); folder = await window.gs2canvasFiles.ensureFolder(ids.courseId); }
            setProgress('Uploading figure ' + (done + 1) + ' of ' + nNeeded, done / total);
            const r = await window.gs2canvasFiles.ensureImage(ids.courseId, folder, { type: im.type, bytes: b64ToBytes(im.base64) });
            p.imageUrls[im.index] = r.url;
            done++;
          }
        }

        // 2. questions, in the order shown
        const planned = [];
        chosen.forEach((p) => {
          const ps = perSource.find((x) => x.src === p.src);
          const one = G.plan(p.src.quiz, { only: [p.q.number], skipContextFor: ps.skipContextFor, imageUrls: ps.imageUrls, namePrefix: p.src.prefix, positionOffset: planned.length })[0];
          if (!one) return;
          const pts = pointsFor.get(p.key);
          if (Number.isFinite(pts)) one.question.points_possible = pts;
          planned.push(one);
        });
        let saved = 0;
        const result = await G.sync(planned, target, {
          update: chosen.filter((p) => p.clash).map((p) => p.name),
          onCreated: (n, id) => { created++; history.addCreated(histId, n, id); },
          onUpdated: (n, id, before) => history.addUpdated(histId, n, id, window.gs2canvasSource.payloadOf(before)),
          onProgress: (n) => { saved++; setProgress('Saved ' + n + ' (' + saved + ' of ' + planned.length + ')', (done + saved) / total); },
        });

        // 3. order (quizzes only). Only when the quiz holds nothing but questions from this import:
        // otherwise moving ours around would disturb the user's own ordering.
        let orderNote = null;
        if (target.ordered) {
          if (otherQuestions > 0) {
            orderNote = 'This quiz already had ' + plural(otherQuestions, 'other question') + ', so new questions were added at the end and the order was left alone. Drag them into place on the Questions tab if needed.';
          } else {
            setProgress('Putting the questions in order', (total - 1) / total);
            const present = new Set(existingNames); chosen.forEach((p) => present.add(p.name));
            // everything of this import that is now in the quiz, in the order shown
            const inOrder = picks.map((p) => p.name).filter((n) => present.has(n));
            try { await target.reorder(inOrder); }
            catch (e) { orderNote = 'The questions were created but couldn’t be put in order automatically (' + ((e && e.message) || e) + '). Drag them into order on the Questions tab.'; }
          }
        }
        await history.done();
        await history.discardIfEmpty(histId);
        setProgress('Done', 1);

        dlg.render({
          title: 'Import finished',
          subtitle: isBank ? 'Into the bank “' + target.bank.title + '”' : null,
          body: [
            h('p', { class: 'lead' }, h('b', {}, String(result.created.length)), ' created, ', h('b', {}, String(result.updated.length)), ' replaced, ', h('b', {}, String(result.skipped.length)), ' left alone.'),
            orderNote ? notice('warn', orderNote) : null,
            isBank
              ? h('p', {}, 'Find them under Question Banks in the course (', h('a', { href: '/courses/' + ids.courseId + '/question_banks/' + target.bank.id, target: '_blank', rel: 'noopener' }, 'open the bank'), '). In a quiz, use Find Questions to pull from it.')
              : h('p', {}, 'Reload the page to see the questions in the editor. Then set the quiz title and settings, and publish when you’re ready.'),
          ],
          actions: [
            result.created.length + result.updated.length ? button('Undo this import', { onclick: () => confirmUndo(histId, openHub) }) : null,
            button('Clear copied questions', { onclick: async () => { await chrome.storage.local.remove('basket'); dlg.close(); } }),
            closeButton('Close'),
            isBank ? null : button('Reload page', { variant: 'primary', onclick: () => location.reload() }),
          ],
        });
      } catch (e) {
        try { await history.done(); if (histId) await history.discardIfEmpty(histId); } catch (_) { /* best effort */ }
        const view = ui.failureView({ error: e, step, extra, actions: [closeButton('Close'), button('Try again', { variant: 'primary', onclick: () => run() })] });
        if (created) view.body.splice(2, 0, h('p', { class: 'muted' }, plural(created, 'question') + (created === 1 ? ' was' : ' were') + ' created before it stopped.' Trying again skips them, or use Undo an import to remove them.'));
        dlg.render(view);
      }
    }
  }

  // ---- undo -----------------------------------------------------------------------------
  const describeTarget = (t) => (t.kind === 'bank' ? 'the bank “' + t.bankTitle + '”' : (String(t.quizId) === String(ids.quizId) ? 'this quiz' : 'quiz ' + t.quizId));
  const describeEntry = (e) => [e.created.length ? plural(e.created.length, 'question') + ' added' : null, e.updated.length ? plural(e.updated.length, 'question') + ' replaced' : null].filter(Boolean).join(', ') || 'No questions changed';

  async function openUndo() {
    let list = [];
    try { list = await history.list(ids.courseId); } catch (e) { return fail(e, 'Reading the import history'); }
    dlg.render({
      title: 'Undo an import',
      subtitle: 'Recent imports in this course',
      body: list.length ? [h('p', { class: 'muted small' }, 'Undo removes only the questions an import added, and restores the ones it replaced. Figures stay in your course files.'),
        ...list.slice(0, 8).map((e) => h('div', { class: 'choice row' }, h('span', {}, h('span', { class: 't' }, describeEntry(e) + ' in ' + describeTarget(e.target)), h('span', { class: 'q' }, when(e.at))),
          button('Undo…', { onclick: () => confirmUndo(e.id, openUndo) })))]
        : [h('p', {}, 'There’s nothing to undo.')],
      actions: [button('Back', { onclick: openHub })],
    });
  }

  async function confirmUndo(entryId, back) {
    let entry;
    try { entry = (await history.list(ids.courseId)).find((e) => e.id === entryId); } catch (e) { return fail(e, 'Reading the import history'); }
    if (!entry) return dlg.render({ title: 'Already undone', body: [h('p', {}, 'That import has already been undone.')], actions: [closeButton('Close', true)] });
    const t = entry.target;
    dlg.render({
      title: 'Undo this import?',
      subtitle: when(entry.at) + ', into ' + describeTarget(t),
      body: [
        entry.created.length ? notice('warn', plural(entry.created.length, 'question') + ' will be deleted from ' + describeTarget(t) + '. Anything you changed in ' + (entry.created.length === 1 ? 'it' : 'them') + ' since the import is lost.') : null,
        entry.updated.length ? notice('info', plural(entry.updated.length, 'question') + ' that the import replaced will go back to how ' + (entry.updated.length === 1 ? 'it was.' : 'they were.')) : null,
        t.bankCreated ? notice('info', 'The bank “' + t.bankTitle + '” was created by this import, so it’s removed too if it ends up empty.') : null,
        h('p', { class: 'muted small' }, 'Questions that were added or replaced by hand are never touched. Uploaded figures stay in your course files.'),
      ],
      actions: [button('Keep the import', { onclick: back }), button(entry.created.length ? 'Delete ' + plural(entry.created.length, 'question') : 'Restore questions', { variant: 'danger', onclick: () => runUndo(entry) })],
    });
  }

  async function runUndo(entry) {
    const bar = h('i', {}); const label = h('p', { class: 'muted' }, 'Starting…'); let step = 'Starting the undo';
    dlg.render({ title: 'Undoing', subtitle: 'Keep this tab open until it finishes.', body: [h('div', { class: 'progress' }, h('div', { class: 'bar' }, bar), label)], locked: true });
    try {
      const res = await history.undo(entry, { quizTarget: G.quizTarget, bankTarget: G.bankTarget, deleteBank: G.deleteBank },
        (text, frac) => { step = text; label.textContent = text; bar.style.width = frac * 100 + '%'; });
      if (res.failed.length) {
        const err = res.lastError || new Error('Some questions could not be changed');
        const view = ui.failureView({ error: err, step, extra: { Removed: res.deleted, Restored: res.restored, 'Not changed': res.failed.length }, actions: [closeButton('Close')] });
        view.body.splice(2, 0, notice('warn', 'Not changed: ' + res.failed.join(', ') + '. The import stays in your list, so you can try again.'));
        return dlg.render(view);
      }
      dlg.render({
        title: 'Import undone',
        body: [h('p', { class: 'lead' }, h('b', {}, String(res.deleted)), ' removed, ', h('b', {}, String(res.restored)), ' restored.'),
          res.gone ? h('p', { class: 'muted' }, plural(res.gone, 'question') + ' had already been removed.') : null,
          res.bankDeleted ? h('p', { class: 'muted' }, 'The empty bank was removed too.') : null,
          entry.target.kind === 'quiz' ? h('p', {}, 'Reload the page to see the quiz as it is now.') : null],
        actions: [closeButton('Close', entry.target.kind === 'bank'), entry.target.kind === 'quiz' ? button('Reload page', { variant: 'primary', onclick: () => location.reload() }) : null],
      });
    } catch (e) { fail(e, step, { Entry: entry.id }, [closeButton('Close')]); }
  }
})();
