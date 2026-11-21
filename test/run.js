const fs = require('fs'), path = require('path');
global.document = { cookie: "" }; // importer reads document.cookie for the CSRF token
const assert = require('assert');
require('../extension/lib/tex-code.js'); require('../extension/lib/import-canvas.js');
const { texToCode } = globalThis.gs2canvasTexCode;

// code-as-math -> code
assert.strictEqual(texToCode('\\text{SELECT a, b} \\\\ \\text{FROM t} \\\\ \\text{WHERE c = `red\x27;}'), "SELECT a, b\nFROM t\nWHERE c = 'red';");
assert.strictEqual(texToCode('\\text{SELECT COUNT(*) AS n\\_x} \\\\ \\text{FROM t;}'), 'SELECT COUNT(*) AS n_x\nFROM t;');
assert.strictEqual(texToCode('\\text{SELECT *} \\ \\text{FROM R);}'), 'SELECT * FROM R);');
// real math must be left alone
assert.strictEqual(texToCode('\\pi_{Title}(\\sigma_{a=1} R)'), null);
assert.strictEqual(texToCode('\\text{Cust}'), null);               // single word, no break, not SQL
assert.strictEqual(texToCode('\\text{a} \\\\ x^2'), null);          // mixed
// importer
const q = { images: [], sections: [{ number: 'Q1', type: 'group', prompt: '', children: [{ number: 'Q1.1', type: 'multiple_choice', points: 3, prompt: 'Pick \\(x^2\\)', choices: [{ text: 'a', correct: false }, { text: '```\nSELECT 1;\n```', correct: true }] }] }] };
const p = gs2canvas.plan(q)[0].question;
assert.ok(p.question_text.includes('equation_image'));
assert.strictEqual(p.answers[1].answer_weight, 100);
assert.ok(p.answers[1].answer_html.startsWith('<pre><code>SELECT 1;'));
assert.strictEqual(p.answers[1].answer_text, 'SELECT 1;');
console.log('all tests passed');

// images + positions
const qi = { images: [{}, {}], sections: [{ number: 'Q1', type: 'group', prompt: '', children: [
  { number: 'Q1.1', type: 'multiple_choice', points: 1, prompt: 'see [[image:1]]', choices: [{ text: 'a', correct: true }] },
  { number: 'Q1.2', type: 'multiple_choice', points: 1, prompt: 'x', choices: [{ text: 'b', correct: true }] }] }] };
const pi = gs2canvas.plan(qi, { imageUrls: { 1: '/courses/123/files/456/preview' } });
assert.ok(pi[0].question.question_text.includes('data-api-endpoint="/api/v1/courses/123/files/456"'));
assert.ok(pi[0].question.question_text.includes('src="/courses/123/files/456/preview"'));
assert.deepStrictEqual(pi.map((p) => p.question.position), [1, 2]);
assert.ok(gs2canvas.plan(qi)[0].question.question_text.includes('NOT UPLOADED'));
console.log('image/position tests passed');

// api()/reorder against a fake Canvas: 204 must not throw, and a mismatched order must refuse
(async () => {
  const calls = [];
  let qs = [{ id: 11, question_name: 'Q1.2' }, { id: 10, question_name: 'Q1.1' }];
  global.fetch = async (path, init) => {
    calls.push([init.method, path]);
    if (init.method === 'POST' && path.endsWith('/reorder')) {
      const o = JSON.parse(init.body).order; qs = o.map((x) => qs.find((q) => q.id === x.id));
      return { ok: true, status: 204, json: async () => { throw new Error('no body'); } };
    }
    return { ok: true, status: 200, json: async () => qs };
  };
  const after = await gs2canvas.reorder(['Q1.1', 'Q1.2'], { courseId: 1, quizId: 2 });
  assert.deepStrictEqual(after, ['Q1.1', 'Q1.2']);
  await assert.rejects(() => gs2canvas.reorder(['Q9.9'], { courseId: 1, quizId: 2 }), /missing or duplicated/);
  // questions the tool did not create stay in the quiz, after the requested ones
  qs = [{ id: 12, question_name: 'MINE' }, { id: 11, question_name: 'Q1.2' }, { id: 10, question_name: 'Q1.1' }];
  assert.deepStrictEqual(await gs2canvas.reorder(['Q1.1', 'Q1.2'], { courseId: 1, quizId: 2 }), ['Q1.1', 'Q1.2', 'MINE']);
  assert.ok(calls.some(([m, p]) => m === 'POST' && p === '/api/v1/courses/1/quizzes/2/reorder'));
  console.log('reorder tests passed');
})();

// unsupported + select-all types
const qu = { images: [], sections: [{ number: 'Q1', type: 'group', prompt: '', children: [
  { number: 'Q1.1', points: 2, type: 'multiple_answers', prompt: 'pick all', choices: [{ text: 'a', correct: true }, { text: 'b', correct: true }, { text: 'c', correct: false }] },
  { number: 'Q1.2', points: 5, type: 'unsupported', reason: 'free response', prompt: 'explain', choices: [] }] }] };
const pu = gs2canvas.plan(qu);
assert.strictEqual(pu.length, 1);
assert.strictEqual(pu[0].question.question_type, 'multiple_answers_question');
assert.deepStrictEqual(pu[0].question.answers.map((a) => a.answer_weight), [100, 100, 0]);
assert.deepStrictEqual(pu.skipped, [{ number: 'Q1.2', reason: 'free response' }]);
console.log('type tests passed');

// validation
require('../extension/lib/validate.js');
const { validateQuiz } = globalThis.gs2canvasValidate;
const good = { totalPoints: 5, images: [{ alt: 'figure' }], sections: [{ number: 'Q1', type: 'group', points: 5, prompt: 'Shared text', children: [
  { number: 'Q1.1', type: 'multiple_choice', points: 2, prompt: 'Look at [[image:0]] and solve \\(x^2\\)', choices: [{ text: 'a', correct: true }, { text: 'b', correct: false }], correctIndex: 0 },
  { number: 'Q1.2', type: 'multiple_choice', points: 3, prompt: 'Pick one', choices: [{ text: 'a', correct: false }, { text: 'b', correct: true }], correctIndex: 1 }] }] };
const vr = validateQuiz(good);
assert.strictEqual(vr.leaves, 2); assert.strictEqual(vr.supported, 2); assert.strictEqual(vr.points, 5);
assert.strictEqual(vr.images, 1); assert.strictEqual(vr.blocking, false);
assert.deepStrictEqual(vr.warnings, [], 'a well-formed quiz should validate with no warnings: ' + JSON.stringify(vr.warnings));
assert.ok(vr.equations > 0);
// a private real-exam fixture (git-ignored) is checked too when present
const realPath = path.join(__dirname, '..', 'fixtures', 'dbms-exam.gradescope.json');
if (fs.existsSync(realPath)) {
  const rv = validateQuiz(JSON.parse(fs.readFileSync(realPath, 'utf8')));
  assert.deepStrictEqual([rv.supported, rv.points, rv.images, rv.blocking], [32, 100, 4, false]);
}
const mk = (kids, extra) => ({ images: [], totalPoints: null, sections: [Object.assign({ number: 'Q1', type: 'group', points: null, prompt: '', children: kids }, extra)] });
const mc = (n, over) => Object.assign({ number: n, type: 'multiple_choice', points: 2, prompt: 'p', choices: [{ text: 'a', correct: true }, { text: 'b', correct: false }] }, over);
assert.ok(validateQuiz(mk([mc('Q1.1', { choices: [{ text: 'a', correct: false }, { text: 'b', correct: false }] })])).blocking, 'no key must block');
assert.ok(validateQuiz(mk([mc('Q1.1'), mc('Q1.1')])).blocking, 'duplicate numbers must block');
assert.ok(validateQuiz(mk([mc('Q1.1', { choices: [{ text: 'a', correct: true }, { text: 'b', correct: true }] })])).blocking, 'two keys on single-choice must block');
assert.ok(validateQuiz({ sections: [] }).blocking, 'empty must block');
const vs = validateQuiz(mk([mc('Q1.1'), { number: 'Q1.2', type: 'unsupported', reason: 'free response', choices: [] }]));
assert.ok(!vs.blocking && vs.warnings.some((w) => /SKIPPED/.test(w.text)), 'unsupported warns but does not block');
assert.ok(validateQuiz(mk([mc('Q1.1')], { points: 9 })).warnings.some((w) => /add up/.test(w.text)), 'group points mismatch warns');
console.log('validation tests passed');

// manifest: valid JSON, every referenced file exists, load order resolves
const ext = path.join(__dirname, '..', 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
assert.strictEqual(manifest.manifest_version, 3);
const listed = [manifest.background.service_worker, ...manifest.content_scripts.flatMap((c) => c.js)];
listed.forEach((f) => assert.ok(fs.existsSync(path.join(ext, f)), 'manifest lists missing file: ' + f));
manifest.content_scripts.forEach((cs) => {
  // each content script may only use globals provided by files loaded before it
  const provides = { 'lib/ui.js': 'gs2canvasUI', 'lib/tex-code.js': 'gs2canvasTexCode', 'lib/extract-gradescope.js': 'extractGradescopeQuiz',
    'lib/validate.js': 'gs2canvasValidate', 'lib/import-canvas.js': 'gs2canvas', 'lib/canvas-files.js': 'gs2canvasFiles' };
  const last = cs.js[cs.js.length - 1]; const src = fs.readFileSync(path.join(ext, last), 'utf8');
  Object.entries(provides).forEach(([file, global]) => {
    const used = new RegExp('window\\.' + global + '\\b').test(src);
    if (used) assert.ok(cs.js.indexOf(file) >= 0 && cs.js.indexOf(file) < cs.js.length - 1, last + ' uses ' + global + ' but manifest does not load ' + file + ' first');
  });
});
// icons: every declared size exists and is a PNG of exactly that size; the popup page exists
Object.entries(manifest.icons).forEach(([size, f]) => {
  const buf = fs.readFileSync(path.join(ext, f));
  assert.strictEqual(buf.slice(1, 4).toString(), 'PNG', f + ' is not a PNG');
  assert.strictEqual(buf.readUInt32BE(16), Number(size), f + ' width'); assert.strictEqual(buf.readUInt32BE(20), Number(size), f + ' height');
});
assert.deepStrictEqual(manifest.action.default_icon, manifest.icons);
assert.ok(fs.existsSync(path.join(ext, manifest.action.default_popup)), 'popup page missing');
assert.ok(!/<script/i.test(fs.readFileSync(path.join(ext, manifest.action.default_popup), 'utf8')), 'popup must not use scripts (MV3 CSP)');
// least privilege: only the two sites + storage
assert.deepStrictEqual(manifest.permissions.sort(), ['storage', 'unlimitedStorage']);
manifest.host_permissions.forEach((h) => assert.ok(/gradescope/.test(h), 'unexpected host permission: ' + h));
console.log('manifest tests passed');

// background worker: only fetches Gradescope URLs, only for Gradescope tabs, caps size, returns base64
(async () => {
  const vm = require('vm');
  let listener = null; const fetched = [];
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const ctx = { chrome: { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } }, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    fetch: async (url) => { fetched.push(url); return { ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.length) }; },
    Uint8Array, String, Error, console };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ext, 'background.js'), 'utf8'), ctx);
  const ask = (msg, sender) => new Promise((res) => { const async_ = listener(msg, sender, res); if (async_ === false) { /* answered synchronously via res */ } });
  const gs = { tab: { url: 'https://www.gradescope.com/courses/1/assignments/2/rubric/edit' } };
  const good = await ask({ type: 'gs2canvas:fetchImage', url: 'https://www.gradescope.com/files/abc' }, gs);
  assert.ok(good.ok && good.type === 'image/png' && Buffer.from(good.base64, 'base64').equals(png), 'allowed fetch returns exact bytes');
  assert.ok(!(await ask({ type: 'gs2canvas:fetchImage', url: 'https://evil.example/x.png' }, gs)).ok, 'non-Gradescope URL refused');
  assert.ok(!(await ask({ type: 'gs2canvas:fetchImage', url: 'https://www.gradescope.com.evil.example/files/x' }, gs)).ok, 'look-alike host refused');
  assert.ok(!(await ask({ type: 'gs2canvas:fetchImage', url: 'https://www.gradescope.com/files/abc' }, { tab: { url: 'https://canvas.example.edu/' } })).ok, 'request from a non-Gradescope tab refused');
  assert.ok(!(await ask({ type: 'gs2canvas:fetchImage', url: 'https://www.gradescope.com/files/abc' }, {})).ok, 'request with no tab refused');
  assert.strictEqual(fetched.length, 1, 'refused requests must not hit the network');
  console.log('background tests passed');
})();

// UI: render with a tiny stand-in DOM and check the visible text (catches "[object HTMLElement]"-style bugs)
(() => {
  class El {
    constructor(tag) { this.tag = tag; this.nodeType = 1; this.children = []; this.attrs = {}; this.classList = { add() {} }; this.style = {}; }
    append(...kids) { kids.forEach((k) => this.children.push(k)); }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener() {}
    set className(v) { this.attrs.class = v; }
    replaceChildren(...k) { this.children = k; }
    get text() { return this.children.map((c) => (c.nodeType === 3 ? c.data : c.text)).join(''); }
  }
  const saved = { document: global.document };
  global.document = { createElement: (t) => new El(t), createElementNS: (_n, t) => new El(t), createTextNode: (d) => ({ nodeType: 3, data: d }), cookie: '' };
  delete require.cache[require.resolve('../extension/lib/ui.js')];
  require('../extension/lib/ui.js');
  const ui = globalThis.gs2canvasUI;
  assert.strictEqual(ui.summary({ supported: 32, points: 100, images: 4, equations: 12 }).text, '32 questions worth 100 points, with 4 figures and 12 equations.');
  assert.strictEqual(ui.summary({ supported: 1, points: 1, images: 1, equations: 0 }).text, '1 question worth 1 point, with 1 figure.');
  assert.strictEqual(ui.summary({ supported: 5, points: 10, images: 0, equations: 0 }).text, '5 questions worth 10 points.');
  assert.strictEqual(ui.h('p', {}, ['a', ['b', [null, 'c']]], 'd').text, 'abcd', 'deeply nested children must flatten');
  assert.strictEqual(ui.plural(1, 'question'), '1 question'); assert.strictEqual(ui.plural(2, 'question has a name', 'questions have names'), '2 questions have names');
  assert.ok(!/\[object/.test(ui.notice('warn', 'x').text + ui.launcher('Go', () => {}).text));
  global.document = saved.document;
  console.log('ui tests passed');
})();

// several quizzes in one Canvas quiz: names are prefixed, subset validation ignores whole-quiz totals
(() => {
  require('../extension/lib/validate.js');
  const { validateQuiz, imagesUsed } = globalThis.gs2canvasValidate;
  const quiz = { images: [{}, {}, {}], totalPoints: 10, sections: [
    { number: 'Q1', type: 'group', points: 6, prompt: 'Look at [[image:0]]', children: [
      { number: 'Q1.1', type: 'multiple_choice', points: 3, prompt: 'a [[image:1]]', choices: [{ text: 'x', correct: true }, { text: 'y', correct: false }] },
      { number: 'Q1.2', type: 'multiple_choice', points: 3, prompt: 'b', choices: [{ text: '[[image:2]]', correct: true }] }] }] };
  const subset = { images: quiz.images, totalPoints: null, sections: [Object.assign({}, quiz.sections[0], { points: null, children: [quiz.sections[0].children[0]] })] };
  assert.ok(validateQuiz(subset).warnings.some((w) => /Figure count/.test(w.text)), 'full validation flags a partial copy');
  assert.strictEqual(validateQuiz(subset, { subset: true }).warnings.length, 0, 'subset validation does not');
  assert.deepStrictEqual([...imagesUsed(quiz, ['Q1.1'], [])].sort(), [0, 1], 'group text figure + own figure');
  assert.deepStrictEqual([...imagesUsed(quiz, ['Q1.1'], ['Q1'])], [1], 'repeat-off group text drops its figure');
  assert.deepStrictEqual([...imagesUsed(quiz, ['Q1.2'], [])].sort(), [0, 2], 'figure inside a choice');
  const a = gs2canvas.plan(quiz, { namePrefix: 'Exam A: ' }), b = gs2canvas.plan(quiz, { namePrefix: 'Exam B: ', positionOffset: 2 });
  assert.deepStrictEqual(a.map((p) => p.number).concat(b.map((p) => p.number)), ['Exam A: Q1.1', 'Exam A: Q1.2', 'Exam B: Q1.1', 'Exam B: Q1.2']);
  assert.strictEqual(b[0].question.question_name, 'Exam B: Q1.1');
  assert.strictEqual(b[0].question.position, 3);
  console.log('basket tests passed');
})();

// copying between Canvas quizzes
(() => {
  require('../extension/lib/canvas-source.js');
  const { fromCanvas } = globalThis.gs2canvasSource;
  const qs = [
    { id: 2, position: 2, question_name: 'Question', question_type: 'true_false_question', points_possible: 1, question_text: '<p>Sky is blue</p>', answers: [{ text: 'True', weight: 100 }, { text: 'False', weight: 0 }] },
    { id: 1, position: 1, question_name: 'Question', question_type: 'multiple_choice_question', points_possible: 3, question_text: '<p>Pick <img class="equation_image" src="/equation_images/x"> and <img src="/courses/9/files/5/preview"></p>',
      correct_comments: 'Nice', answers: [{ id: 7, text: 'a', html: '', weight: 0 }, { id: 8, text: 'b', html: '<b>b</b>', weight: 100, comments: 'yes' }] },
    { id: 3, position: 3, question_type: 'matching_question', points_possible: 2, question_text: 'm', answers: [] },
    { id: 4, position: 4, question_type: 'essay_question', points_possible: 5, question_text: 'Explain' },
  ];
  const src = fromCanvas(qs, { courseId: 9, quizId: 4, title: 'Quiz A' });
  const L = src.quiz.sections;
  assert.strictEqual(src.id, 'canvas-9-4');
  assert.deepStrictEqual(L.map((q) => q.number), ['1', '2', '3', '4'], 'ordered by position, numbered uniquely');
  assert.deepStrictEqual(L[0].answerChips, ['B']);
  assert.strictEqual(L[0].includes, 'figure, math');
  assert.strictEqual(L[1].answerText, 'True');
  assert.ok(!L[2].raw && L[2].type === 'unsupported' && /matching/.test(L[2].reason), 'unsupported types are reported, not copied');
  assert.deepStrictEqual(src.fileCourses, [9]);
  const v = validateQuiz(src.quiz, { subset: true });
  assert.ok(!v.blocking && v.supported === 3 && v.points === 9, 'raw questions validate without choice checks');
  assert.ok(v.warnings.some((w) => /SKIPPED/.test(w.text)), 'the unsupported one is flagged');
  const pl = gs2canvas.plan(src.quiz, { only: ['1', '2', '4'], namePrefix: 'Quiz A: ' });
  assert.deepStrictEqual(pl.map((p) => p.question.question_name), ['Quiz A: 1', 'Quiz A: 2', 'Quiz A: 4']);
  assert.strictEqual(pl[0].question.question_type, 'multiple_choice_question');
  assert.deepStrictEqual(pl[0].question.answers[1], { answer_text: 'b', answer_weight: 100, answer_html: '<b>b</b>', answer_comments: 'yes' });
  assert.strictEqual(pl[0].question.correct_comments, 'Nice');
  assert.strictEqual(pl[2].question.answers, undefined, 'essay has no answers');
  assert.strictEqual(pl[1].question.position, 2);
  console.log('canvas source tests passed');
})();
