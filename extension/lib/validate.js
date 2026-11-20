/**
 * Sanity-check a captured quiz before it is imported. Pure function, no DOM.
 * Anything that would silently produce a wrong quiz (missing key, points that do not add up,
 * duplicate names, skipped questions) is surfaced here as a warning or error.
 *
 * Returns { leaves, supported, points, equations, images, warnings: [{level, text}], blocking }
 * `blocking` is true when importing would be unsafe (shown as errors; the importer refuses).
 */
(function (root) {
  const ok = (q) => q.type === 'multiple_choice' || q.type === 'multiple_answers';

  function validateQuiz(quiz) {
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
      if (!q.choices.some((c) => c.correct)) add('error', q.number + ' has no correct answer marked; it would grade everyone wrong.');
      if (q.type === 'multiple_choice' && q.choices.filter((c) => c.correct).length > 1) add('error', q.number + ' marks more than one correct answer but is single-choice.');
      if (!q.prompt) add('warn', q.number + ' has an empty question text.');
      if (q.choices.some((c) => !c.text)) add('warn', q.number + ' has an empty answer choice.');
    });

    const supported = leaves.filter(ok);
    const points = supported.reduce((a, q) => a + (q.points || 0), 0);

    (quiz.sections || []).forEach((s) => {
      if (s.type !== 'group' || s.points == null) return;
      const sum = s.children.filter(ok).reduce((a, q) => a + (q.points || 0), 0);
      const skipped = s.children.length - s.children.filter(ok).length;
      if (!skipped && Math.abs(sum - s.points) > 1e-9) add('warn', s.number + ' is worth ' + s.points + ' on Gradescope but its questions add up to ' + sum + '.');
    });
    if (quiz.totalPoints != null && Math.abs(points - quiz.totalPoints) > 1e-9 && supported.length === leaves.length) {
      add('warn', 'Gradescope says ' + quiz.totalPoints + ' points but the questions add up to ' + points + '.');
    }

    const text = JSON.stringify(leaves);
    const equations = (text.match(/\\\\\(/g) || []).length + (text.match(/\\\\\[/g) || []).length;
    const refs = new Set((text.match(/\[\[image:(\d+)\]\]/g) || []));
    if (refs.size !== (quiz.images || []).length) add('warn', 'Figure count mismatch: ' + refs.size + ' referenced in questions, ' + (quiz.images || []).length + ' found.');

    return {
      leaves: leaves.length, supported: supported.length, points, equations,
      images: (quiz.images || []).length, warnings,
      blocking: warnings.some((w) => w.level === 'error'),
    };
  }

  root.gs2canvasValidate = { validateQuiz };
})(typeof window !== 'undefined' ? window : globalThis);
