/**
 * Neutral quiz JSON (gs2canvas/1) -> Canvas classic quiz questions.
 *
 * Runs on a canvas.../courses/:c/quizzes/:q/edit page. Uses the user's own
 * logged-in session (same-origin fetch + Canvas's CSRF cookie); no API token.
 *
 *   const plan = gs2canvas.plan(quiz, { only: ['Q1.1'] });   // pure, no network
 *   await gs2canvas.run(plan, { courseId, quizId });          // writes to Canvas
 */
(function (root) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

  // Canvas stores each equation as an image whose URL double-encodes the LaTeX.
  const eqImg = (tex) =>
    '<img class="equation_image" title="' + escAttr(tex) + '" src="/equation_images/' +
    encodeURIComponent(encodeURIComponent(tex)) + '" alt="LaTeX: ' + escAttr(tex) +
    '" data-equation-content="' + escAttr(tex) + '">';

  function inline(text, imageHtml) {
    const re = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\[\[image:(\d+)\]\]/g;
    let out = '', last = 0, m;
    while ((m = re.exec(text))) {
      out += esc(text.slice(last, m.index)).replace(/\n/g, '<br>');
      if (m[1] !== undefined) out += eqImg(m[1]);
      else if (m[2] !== undefined) out += eqImg(m[2]);
      else out += imageHtml(Number(m[3]));
      last = re.lastIndex;
    }
    return out + esc(text.slice(last)).replace(/\n/g, '<br>');
  }

  // neutral text -> HTML. Code fences are block-level; everything else is <p>.
  function toHtml(text, imageHtml) {
    const parts = String(text || '').split(/```\n([\s\S]*?)\n```/);
    let html = '';
    parts.forEach((p, i) => {
      if (i % 2 === 1) { html += '<pre><code>' + esc(p) + '</code></pre>'; return; }
      p.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
        .forEach((para) => { html += '<p>' + inline(para, imageHtml) + '</p>'; });
    });
    return html;
  }

  // plain-text twin of toHtml, used for Canvas's answer_text field
  const toPlain = (text) =>
    String(text || '').replace(/```\n?/g, '').replace(/\\\(([\s\S]*?)\\\)/g, '$1').replace(/\\\[([\s\S]*?)\\\]/g, '$1')
      .replace(/\[\[image:\d+\]\]/g, '').trim();

  /**
   * opts.only:     array of question numbers to include (default: all)
   * opts.imageUrls: { N: canvasUrl } for [[image:N]]; unresolved -> placeholder
   * opts.namePrefix: text put before each question number to make the Canvas question name
   *                 (keeps names unique when questions from several quizzes share one Canvas quiz)
   * opts.groupContext: 'inline' = prepend a group's prompt to each child
   */
  function plan(quiz, opts) {
    opts = opts || {};
    const imageHtml = (n) => {
      const u = opts.imageUrls && opts.imageUrls[n];
      if (!u) return '<strong>[IMAGE ' + n + ' NOT UPLOADED]</strong>';
      // Same markup Canvas's rich editor emits; the data-api-* attributes let Canvas
      // attach access verifiers so students can see files in a hidden folder.
      const m = /\/courses\/(\d+)\/files\/(\d+)/.exec(u);
      const api = m ? ' data-api-endpoint="/api/v1/courses/' + m[1] + '/files/' + m[2] + '" data-api-returntype="File"' : '';
      return '<img src="' + escAttr(u) + '" alt="Figure ' + (n + 1) + '"' + api + '>';
    };
    const questions = [];
    questions.skipped = []; // questions this tool cannot copy (reported, never silently dropped)
    quiz.sections.forEach((sec) => {
      const kids = sec.type === 'group' ? sec.children : [sec];
      kids.forEach((q) => {
        if (opts.only && !opts.only.includes(q.number)) return;
        if (q.raw) { // a question copied from another Canvas quiz: re-create it as it was
          const nm = (opts.namePrefix || '') + q.number;
          questions.push({ number: nm, question: Object.assign({}, q.raw, { position: questions.length + 1 + (opts.positionOffset || 0), question_name: nm }) });
          return;
        }
        if (q.type !== 'multiple_choice' && q.type !== 'multiple_answers') {
          questions.skipped.push({ number: q.number, reason: q.reason || ('unsupported type: ' + q.type) });
          return;
        }
        const ctx = sec.type === 'group' && opts.groupContext !== 'none' && sec.prompt && !(opts.skipContextFor || []).includes(sec.number)
          ? toHtml(sec.prompt, imageHtml) : '';
        const name = (opts.namePrefix || '') + q.number;
        questions.push({
          number: name,
          question: {
            position: questions.length + 1 + (opts.positionOffset || 0),
            question_name: name,
            question_text: ctx + toHtml(q.prompt, imageHtml),
            question_type: q.type === 'multiple_answers' ? 'multiple_answers_question' : 'multiple_choice_question',
            points_possible: q.points,
            answers: q.choices.map((c) => ({
              answer_text: toPlain(c.text),
              answer_html: toHtml(c.text, imageHtml),
              answer_weight: c.correct ? 100 : 0,
            })),
          },
        });
      });
    });
    return questions;
  }

  const csrf = () => { const m = document.cookie.match(/(?:^|; )_csrf_token=([^;]*)/); return m ? decodeURIComponent(m[1]) : ''; };

  async function api(method, path, body, accept) {
    const res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: accept || 'application/json', 'X-CSRF-Token': csrf() },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw await (root.gs2canvasErrors ? root.gs2canvasErrors.httpError(method, path, res) : new Error(method + ' ' + path + ' -> ' + res.status));
    return res.status === 204 ? null : res.json(); // reorder answers 204 with no body
  }

  const listQuestions = (c, q) => api('GET', '/api/v1/courses/' + c + '/quizzes/' + q + '/questions?per_page=100');

  // Sequential on purpose: keeps order stable and stops at the first failure.
  async function run(planned, ids, onProgress) {
    const created = [];
    for (const p of planned) {
      const r = await api('POST', '/api/v1/courses/' + ids.courseId + '/quizzes/' + ids.quizId + '/questions', { question: p.question });
      created.push({ number: p.number, id: r.id });
      if (onProgress) onProgress(p.number, r.id);
    }
    return created;
  }

  // --- where questions go: a quiz, or a question bank ---------------------------------
  const STR_IDS = 'application/json+canvas-string-ids, application/json';

  /** The quiz being edited. Questions are ordered, so reorder() applies. */
  function quizTarget(ids) {
    const base = '/api/v1/courses/' + ids.courseId + '/quizzes/' + ids.quizId + '/questions';
    return {
      kind: 'quiz', ids, ordered: true, label: 'this quiz',
      list: () => api('GET', base + '?per_page=100'),
      create: (question) => api('POST', base, { question }),
      update: (id, question) => api('PUT', base + '/' + id, { question }),
      remove: (id) => api('DELETE', base + '/' + id),
      reorder: (numbers) => reorder(numbers, ids),
    };
  }

  /** A course question bank. Not part of the public API: these are the routes Canvas's own pages use. */
  function bankTarget(courseId, bank) {
    const root_ = '/courses/' + courseId + '/question_banks/' + bank.id;
    return {
      kind: 'bank', ids: { courseId, bankId: bank.id }, ordered: false, label: 'the bank “' + bank.title + '”', bank,
      async list() {
        const out = [];
        for (let page = 1; page <= 50; page++) {
          const r = await api('GET', root_ + '/questions?page=' + page, null, STR_IDS);
          (r.questions || []).forEach((x) => { const a = x.assessment_question; out.push(Object.assign({}, a.question_data, { id: a.id, question_name: a.name || (a.question_data || {}).question_name })); });
          if (!r.pages || page >= r.pages) break;
        }
        return out;
      },
      create: (question) => api('POST', root_ + '/assessment_questions', { question }, STR_IDS),
      update: (id, question) => api('PUT', root_ + '/assessment_questions/' + id, { question }, STR_IDS),
      remove: (id) => api('DELETE', root_ + '/assessment_questions/' + id, null, STR_IDS),
    };
  }

  async function listBanks(courseId) {
    const r = await api('GET', '/courses/' + courseId + '/question_banks.json', null, STR_IDS);
    return r.map((x) => x.assessment_question_bank).filter((b) => b.workflow_state === 'active' && String(b.context_id) === String(courseId)).map((b) => ({ id: b.id, title: b.title }));
  }
  async function createBank(courseId, title) {
    const r = await api('POST', '/courses/' + courseId + '/question_banks', { assessment_question_bank: { title } }, STR_IDS);
    const b = r.assessment_question_bank || r; return { id: b.id, title: b.title };
  }
  const deleteBank = (courseId, bankId) => api('DELETE', '/courses/' + courseId + '/question_banks/' + bankId, null, STR_IDS);

  /**
   * Idempotent: questions already at the target (matched by question_name) are skipped,
   * unless listed in opts.update, in which case they are overwritten in place.
   * Never deletes anything. `target` is a quizTarget/bankTarget (or quiz ids, for old callers).
   * opts.onCreated(number, id) and opts.onUpdated(number, id, beforeQuestion) fire as each write
   * succeeds, so an interrupted import can still be recorded (and undone).
   */
  async function sync(planned, target, opts) {
    opts = opts || {};
    if (!target.list) target = quizTarget(target);
    const existing = {}, before = {};
    (await target.list()).forEach((q) => { existing[q.question_name] = q.id; before[q.question_name] = q; });
    const result = { created: [], updated: [], skipped: [] };
    for (const p of planned) {
      const id = existing[p.number];
      if (id && !(opts.update || []).includes(p.number)) { result.skipped.push(p.number); continue; }
      if (id) {
        await target.update(id, p.question); result.updated.push(p.number);
        if (opts.onUpdated) opts.onUpdated(p.number, id, before[p.number]);
      } else {
        const r = await target.create(p.question); result.created.push(p.number); existing[p.number] = r.id;
        if (opts.onCreated) opts.onCreated(p.number, r.id);
      }
      if (opts.onProgress) opts.onProgress(p.number);
    }
    return result;
  }

  /**
   * Canvas ignores `position` on create/update, so order is fixed afterwards with the
   * documented reorder endpoint. `numbers` is the desired order of question_names.
   * Every requested name must exist exactly once; any other questions already in the
   * quiz keep their relative order and are placed after the requested ones.
   */
  async function reorder(numbers, ids) {
    const got = await listQuestions(ids.courseId, ids.quizId);
    const idByName = {};
    got.forEach((q) => { (idByName[q.question_name] = idByName[q.question_name] || []).push(q.id); });
    const bad = numbers.filter((n) => !idByName[n] || idByName[n].length !== 1);
    if (bad.length) throw new Error('reorder: missing or duplicated in quiz: ' + bad.join(', '));
    const want = new Set(numbers);
    const order = numbers.map((n) => ({ id: idByName[n][0], type: 'question' }))
      .concat(got.filter((q) => !want.has(q.question_name)).map((q) => ({ id: q.id, type: 'question' })));
    await api('POST', '/api/v1/courses/' + ids.courseId + '/quizzes/' + ids.quizId + '/reorder', { order });
    return (await listQuestions(ids.courseId, ids.quizId)).map((q) => q.question_name);
  }

  root.gs2canvas = { plan, run, sync, reorder, listQuestions, toHtml, api, quizTarget, bankTarget, listBanks, createBank, deleteBank };
})(typeof window !== 'undefined' ? window : globalThis);
