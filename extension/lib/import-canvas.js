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

  async function api(method, path, body) {
    const res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf() },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(method + ' ' + path + ' -> ' + res.status);
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

  /**
   * Idempotent: questions already in the quiz (matched by question_name) are skipped,
   * unless listed in opts.update, in which case they are overwritten in place.
   * Never deletes anything.
   */
  async function sync(planned, ids, opts) {
    opts = opts || {};
    const base = '/api/v1/courses/' + ids.courseId + '/quizzes/' + ids.quizId + '/questions';
    const existing = {};
    (await listQuestions(ids.courseId, ids.quizId)).forEach((q) => { existing[q.question_name] = q.id; });
    const result = { created: [], updated: [], skipped: [] };
    for (const p of planned) {
      const id = existing[p.number];
      if (id && !(opts.update || []).includes(p.number)) { result.skipped.push(p.number); continue; }
      if (id) { await api('PUT', base + '/' + id, { question: p.question }); result.updated.push(p.number); }
      else { const r = await api('POST', base, { question: p.question }); result.created.push(p.number); existing[p.number] = r.id; }
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

  root.gs2canvas = { plan, run, sync, reorder, listQuestions, toHtml, api };
})(typeof window !== 'undefined' ? window : globalThis);
