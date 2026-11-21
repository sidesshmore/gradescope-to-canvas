/**
 * Sanity-check a captured quiz before it is imported. Pure function, no DOM.
 * Anything that would silently produce a wrong quiz (missing key, points that do not add up,
 * duplicate names, skipped questions) is surfaced here as a warning or error.
 *
 * Returns { leaves, supported, points, equations, images, warnings: [{level, text}], blocking }
 * `blocking` is true when importing would be unsafe (shown as errors; the importer refuses).
 */
(function (root) {
  const ok = (q) => !!q.raw || q.type === 'multiple_choice' || q.type === 'multiple_answers';

  // opts.subset: the quiz holds only the questions the user picked, so totals taken from the
  // whole Gradescope quiz (group points, total points, figure count) no longer apply.
  function validateQuiz(quiz, opts) {
    const subset = !!(opts && opts.subset);
    const warnings = [];
    const add = (level, text) => warnings.push({ level, text });
    const leaves = [];
    (quiz.sections || []).forEach((s) => {
      if (s.type === 'group') s.children.forEach((c) => leaves.push(c)); else leaves.push(s);
    });

    if (!leaves.length) add('error', 'No questions were found on this page.');

    const seen = {};
    leaves.forEach((q) => {
      if (seen[q.number]) add('error', 'Question number ' + q.number + ' appears more than once (Canvas matching is by name).');
      seen[q.number] = true;
      if (!ok(q)) { add('warn', q.number + ' will be SKIPPED: ' + (q.reason || 'unsupported type "' + q.type + '"') + '.'); return; }
      if (q.points === null || q.points === undefined) add('warn', q.number + ' has no point value.');
      if (q.raw) return; // copied from Canvas: kept as it was
      if (!q.choices.some((c) => c.correct)) add('error', q.number + ' has no correct answer marked; it would grade everyone wrong.');
      if (q.type === 'multiple_choice' && q.choices.filter((c) => c.correct).length > 1) add('error', q.number + ' marks more than one correct answer but is single-choice.');
      if (!q.prompt) add('warn', q.number + ' has an empty question text.');
      if (q.choices.some((c) => !c.text)) add('warn', q.number + ' has an empty answer choice.');
    });

    const supported = leaves.filter(ok);
    const points = supported.reduce((a, q) => a + (q.points || 0), 0);

    (quiz.sections || []).forEach((s) => {
      if (subset || s.type !== 'group' || s.points == null) return;
      const sum = s.children.filter(ok).reduce((a, q) => a + (q.points || 0), 0);
      const skipped = s.children.length - s.children.filter(ok).length;
      if (!skipped && Math.abs(sum - s.points) > 1e-9) add('warn', s.number + ' is worth ' + s.points + ' on Gradescope but its questions add up to ' + sum + '.');
    });
    if (!subset && quiz.totalPoints != null && Math.abs(points - quiz.totalPoints) > 1e-9 && supported.length === leaves.length) {
      add('warn', 'Gradescope says ' + quiz.totalPoints + ' points but the questions add up to ' + points + '.');
    }

    const text = JSON.stringify(leaves);
    const equations = (text.match(/\\\\\(/g) || []).length + (text.match(/\\\\\[/g) || []).length;
    const refs = new Set((text.match(/\[\[image:(\d+)\]\]/g) || []));
    if (!subset && refs.size !== (quiz.images || []).length) add('warn', 'Figure count mismatch: ' + refs.size + ' referenced in questions, ' + (quiz.images || []).length + ' found.');

    return {
      leaves: leaves.length, supported: supported.length, points, equations,
      images: (quiz.images || []).length, warnings,
      blocking: warnings.some((w) => w.level === 'error'),
    };
  }

  /**
   * Figure numbers referenced by the chosen questions, plus by the shared text of their group
   * unless that group is listed in skipContextFor. `only` is an array of question numbers.
   */
  function imagesUsed(quiz, only, skipContextFor) {
    const found = new Set();
    const scan = (t) => { String(t || '').replace(/\[\[image:(\d+)\]\]/g, (_, n) => { found.add(Number(n)); return ''; }); };
    (quiz.sections || []).forEach((sec) => (sec.type === 'group' ? sec.children : [sec]).forEach((q) => {
      if (!only.includes(q.number)) return;
      if (sec.type === 'group' && !(skipContextFor || []).includes(sec.number)) scan(sec.prompt);
      scan(q.prompt); (q.choices || []).forEach((c) => scan(c.text));
    }));
    return found;
  }

  root.gs2canvasValidate = { validateQuiz, imagesUsed };
})(typeof window !== 'undefined' ? window : globalThis);
