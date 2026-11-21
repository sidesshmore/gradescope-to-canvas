/**
 * Gradescope rubric page -> neutral quiz JSON.
 *
 * Runs in the page (content script or console). Pure function of the DOM:
 *   const quiz = extractGradescopeQuiz(document);
 *
 * Text conventions in the output (the "neutral format"):
 *   inline math   \( tex \)
 *   display math  \[ tex \]
 *   images        [[image:N]]   -> quiz.images[N]
 *   code blocks   ```\n...\n```
 *   paragraphs    separated by a blank line
 */
(function (root) {
  function walk(node, ctx) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node;
    const cls = el.classList;
    if (cls.contains('sr-only')) return '';
    if (cls.contains('katex-display') || (cls.contains('katex') && el.closest('.katex-display')) || cls.contains('katex')) {
      const ann = el.querySelector('annotation[encoding="application/x-tex"]');
      if (!ann) return '';
      const tex = ann.textContent.trim();
      // code typed as math (e.g. SQL via \text{..} \\ ..) becomes a real code block
      const T = root.gs2canvasTexCode;
      const code = T ? T.texToCode(tex) : null;
      if (code !== null) return '\n```\n' + code + '\n```\n';
      const display = cls.contains('katex-display') || !!el.closest('.katex-display');
      return display ? '\\[' + tex + '\\]' : '\\(' + tex + '\\)';
    }
    const tag = el.tagName;
    if (tag === 'IMG') {
      let i = ctx.images.findIndex((im) => im.src === el.src);
      if (i < 0) { ctx.images.push({ src: el.src, alt: el.alt || '' }); i = ctx.images.length - 1; }
      return '[[image:' + i + ']]';
    }
    if (tag === 'BR') return '\n';
    if (tag === 'PRE') return '\n```\n' + el.textContent.replace(/\n+$/, '') + '\n```\n';
    if (tag === 'CODE') return el.parentElement && el.parentElement.tagName === 'PRE' ? '' : '`' + el.textContent + '`';
    const inner = Array.from(el.childNodes).map((c) => walk(c, ctx)).join('');
    if (tag === 'P' || tag === 'DIV' && cls.contains('markdownText-inline--paragraph')) return inner + '\n\n';
    return inner;
  }

  function toText(el, ctx) {
    return walk(el, ctx).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function parsePoints(s) {
    const m = /([\d.]+)\s*point/i.exec(s || '');
    return m ? parseFloat(m[1]) : null;
  }

  function extractQuestionNode(q, ctx) {
    const number = (q.querySelector(':scope > .assignmentRubricQuestion--heading .assignmentRubricQuestion--number') || {}).textContent || '';
    const title = (q.querySelector(':scope > .assignmentRubricQuestion--heading .assignmentRubricQuestion--title') || {}).textContent || '';
    const points = parsePoints((q.querySelector(':scope > .assignmentRubricQuestion--heading .assignmentRubricQuestion--points') || {}).textContent);
    const out = { number: number.trim(), title: title.trim(), points };

    const preview = q.querySelector(':scope > .assignmentRubricQuestion--preview, :scope .assignmentRubricQuestion--preview');
    const promptEl = preview && preview.querySelector(':scope .markdownText.u-preserveWhitespace');
    out.prompt = promptEl ? toText(promptEl, ctx) : '';

    const isLeaf = q.classList.contains('assignmentRubricQuestion-leaf');
    if (isLeaf) {
      // Radios = pick one; checkboxes = select all that apply. Anything else (free
      // response, code, etc.) is reported as 'unsupported' rather than silently dropped.
      const inputs = Array.from(q.querySelectorAll('.assignmentRubricQuestion--preview input[type=radio], .assignmentRubricQuestion--preview input[type=checkbox]'));
      const boxes = inputs.some((i) => i.type === 'checkbox');
      if (!inputs.length) {
        out.type = 'unsupported';
        out.reason = 'no multiple-choice options on the rubric page (free response?)';
        out.choices = [];
      } else {
        out.type = boxes ? 'multiple_answers' : 'multiple_choice';
        out.choices = inputs.map((r) => {
          const holder = r.closest('.form--choice') || r.parentElement;
          const label = holder.querySelector('.markdownText');
          return { text: label ? toText(label, ctx) : '', correct: r.checked };
        });
        if (!boxes) out.correctIndex = out.choices.findIndex((c) => c.correct);
      }
    } else {
      out.type = 'group';
      out.children = [];
    }
    return out;
  }

  // Gradescope renders groups and leaves as FLAT siblings; rebuild the tree
  // from numbering ("Q4.7" belongs to "Q4").
  function nest(flat) {
    const top = [];
    const byNumber = {};
    flat.forEach((n) => { byNumber[n.number] = n; });
    flat.forEach((n) => {
      const i = n.number.lastIndexOf('.');
      const parent = i > 0 ? byNumber[n.number.slice(0, i)] : null;
      if (parent && parent.type === 'group') parent.children.push(n); else top.push(n);
    });
    return top;
  }

  /** Counts of the page features the extractor relies on; goes into the diagnostics, never any text. */
  function probeGradescope(doc) {
    const n = (sel) => doc.querySelectorAll(sel).length;
    return {
      'Rubric questions': n('.assignmentRubricQuestion'), 'Answer options (radio)': n('.assignmentRubricQuestion--preview input[type=radio]'),
      'Answer options (checkbox)': n('.assignmentRubricQuestion--preview input[type=checkbox]'), 'Marked correct': n('.assignmentRubricQuestion--preview input:checked'),
      'Math nodes': n('.katex'), 'Images': n('.markdownText img'), 'Has main': !!doc.querySelector('main'), 'Page title': (doc.title || '').slice(0, 60),
    };
  }

  function extractGradescopeQuiz(doc) {
    const ctx = { images: [] };
    if (!doc.querySelector('.assignmentRubricQuestion')) {
      throw root.gs2canvasErrors.pageError('This isn’t a quiz rubric page', 'No rubric questions were found on this page.',
        'Open the assignment’s rubric page (the address ends in /rubric/edit) and try again. If you’re already there, Gradescope may have changed its layout.');
    }
    const header = doc.querySelector('main') ? doc.querySelector('main').textContent.slice(0, 300) : '';
    const flat = Array.from(doc.querySelectorAll('.assignmentRubricQuestion')).map((q) => extractQuestionNode(q, ctx));
    return {
      format: 'gs2canvas/1',
      source: { site: 'gradescope', url: doc.location.href.split('?')[0] },
      title: (((doc.querySelector('.sidebar--title') || {}).textContent || '').replace(/\s*Navigation\s*$/, '').replace(/\s+/g, ' ').trim()) || null,
      totalPoints: parsePoints(header),
      sections: nest(flat),
      images: ctx.images,
    };
  }

  root.extractGradescopeQuiz = extractGradescopeQuiz;
  root.probeGradescope = probeGradescope;
})(typeof window !== 'undefined' ? window : globalThis);
