/**
 * Turns the questions of an existing Canvas quiz into a "source" for the same copy list the
 * Gradescope questions go into, so they can be pasted into another Canvas quiz.
 * Each question keeps its Canvas payload (`raw`) and is re-created as it was. Pure function.
 */
(function (root) {
  const TYPES = {
    multiple_choice_question: 'Multiple choice', multiple_answers_question: 'Select all', true_false_question: 'True / False',
    short_answer_question: 'Fill in the blank', essay_question: 'Essay', text_only_question: 'Text only',
  };
  const COMMENTS = ['correct_comments', 'incorrect_comments', 'neutral_comments', 'correct_comments_html', 'incorrect_comments_html', 'neutral_comments_html'];
  const plainText = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  const LETTERS = 'ABCDEFGHIJ';

  /** The fields needed to create a question like `q` (as Canvas returns it); null for unsupported types. */
  function payloadOf(q) {
    if (!q || !TYPES[q.question_type]) return null;
    const raw = { question_text: String(q.question_text || ''), question_type: q.question_type, points_possible: q.points_possible == null ? null : q.points_possible };
    COMMENTS.forEach((k) => { if (q[k]) raw[k] = q[k]; });
    const answers = Array.isArray(q.answers) ? q.answers : [];
    if (answers.length && q.question_type !== 'essay_question' && q.question_type !== 'text_only_question') {
      raw.answers = answers.map((a) => {
        const o = { answer_text: a.text == null ? '' : a.text, answer_weight: a.weight || 0 };
        if (a.html) o.answer_html = a.html;
        if (a.comments) o.answer_comments = a.comments;
        if (a.comments_html) o.answer_comments_html = a.comments_html;
        return o;
      });
    }
    return raw;
  }

  function fromCanvas(questions, info) {
    const fileCourses = new Set();
    const noteFiles = (html) => String(html || '').replace(/\/courses\/(\d+)\/files\//g, (_, c) => { fileCourses.add(Number(c)); return ''; });
    const sorted = questions.slice().sort((a, b) => (a.position || 0) - (b.position || 0));
    const leaves = sorted.map((q, i) => {
      const leaf = { number: String(i + 1), excerpt: plainText(q.question_text).slice(0, 70), points: q.points_possible == null ? null : q.points_possible, prompt: '', choices: [] };
      if (!TYPES[q.question_type]) return Object.assign(leaf, { type: 'unsupported', reason: 'Canvas question type “' + String(q.question_type).replace(/_question$/, '').replace(/_/g, ' ') + '” isn’t supported yet' });
      const html = String(q.question_text || '');
      noteFiles(html);
      const raw = payloadOf(q);
      const answers = Array.isArray(q.answers) ? q.answers : [];
      answers.forEach((a) => noteFiles(a.html));
      const right = answers.map((a, k) => ({ a, k })).filter((x) => x.a.weight > 0);
      const kind = q.question_type;
      leaf.type = kind.replace(/_question$/, '');
      leaf.raw = raw;
      leaf.answerChips = kind === 'multiple_choice_question' || kind === 'multiple_answers_question' ? right.map((x) => LETTERS[x.k] || '?') : null;
      leaf.answerText = leaf.answerChips ? '' : kind === 'true_false_question' ? right.map((x) => x.a.text).join(', ') : kind === 'short_answer_question' ? answers.map((a) => a.text).join(', ') : TYPES[kind];
      const withEq = /equation_image/.test(html + JSON.stringify(answers.map((a) => a.html || '')));
      leaf.includes = [/<img(?![^>]*equation_image)/.test(html) ? 'figure' : '', withEq ? 'math' : '', /<pre/.test(html) ? 'code' : ''].filter(Boolean).join(', ');
      return leaf;
    });
    return {
      id: 'canvas-' + info.courseId + '-' + info.quizId, kind: 'canvas', title: info.title, url: info.url || null,
      capturedAt: info.capturedAt || new Date().toISOString(),
      quiz: { format: 'gs2canvas/1', source: { site: 'canvas' }, totalPoints: null, images: [], sections: leaves },
      images: [], fileCourses: [...fileCourses],
    };
  }

  root.gs2canvasSource = { fromCanvas, payloadOf, TYPES };
})(typeof window !== 'undefined' ? window : globalThis);
