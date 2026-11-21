/**
 * UI kit for the extension's launcher and dialogs.
 *
 * Everything renders inside a Shadow DOM, so the host page's CSS cannot break it and ours cannot
 * leak out. Content is always set with DOM calls / textContent, never innerHTML, so quiz text
 * can never inject markup. System fonts only: no web fonts are fetched onto school pages.
 *
 * Design system: paper and highlighter. Graphite text and buttons on white; highlighter yellow
 * is the single signature, used for the logo and to mark correct answers, and nowhere else.
 */
(function (root) {
  const CSS = `
  :host { all: initial;
    --ink: #2B2F36; --ink-hover: #1D2025; --text: #2B2F36; --muted: #6A707B; --line: #E4E6EA; --well: #F5F6F7;
    --hl: #FFD84A; --warn: #7A4F00; --warn-bg: #FFF6DD; --err: #A8241B; --err-bg: #FDEEEC; --ring: #2B2F36; }
  * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }

  /* Launcher: a dark tab docked to the right edge. Static, so it is easy to find and never nags. */
  .fab { position: fixed; right: 0; top: 38%; z-index: 2147483000; display: flex; align-items: center; gap: 10px;
    padding: 7px 16px 7px 7px; border: 0; border-radius: 10px 0 0 10px; background: var(--ink); color: #fff;
    font-size: 13px; font-weight: 600; letter-spacing: -.005em; line-height: 1; white-space: nowrap; cursor: pointer;
    box-shadow: 0 1px 2px rgba(20,22,26,.3), 0 6px 16px -4px rgba(20,22,26,.35); transition: transform .12s ease, background .12s ease; }
  .fab:hover { background: var(--ink-hover); transform: translateX(-3px); }
  .fab:focus-visible { outline: 2px solid var(--hl); outline-offset: 2px; }
  .fab .mark { width: 26px; height: 26px; flex: none; display: block; }

  /* Dialog */
  .overlay { position: fixed; inset: 0; z-index: 2147483001; background: rgba(20,22,26,.42); display: flex;
    align-items: center; justify-content: center; padding: 24px; }
  .overlay.enter { animation: gs2c-fade .12s ease-out; }
  .overlay.enter .panel { animation: gs2c-rise .16s ease-out; }
  @keyframes gs2c-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes gs2c-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .panel { display: flex; flex-direction: column; width: min(760px, 100%); max-height: min(720px, calc(100vh - 48px));
    background: #fff; color: var(--text); border-radius: 12px; outline: none; font-size: 13px; line-height: 1.5;
    box-shadow: 0 0 0 1px rgba(20,22,26,.08), 0 24px 60px -12px rgba(20,22,26,.4); }
  .head { display: flex; align-items: center; gap: 12px; padding: 20px 24px 4px; }
  .head .mark { width: 32px; height: 32px; flex: none; }
  h2 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -.01em; line-height: 1.3; }
  .sub { margin: 1px 0 0; color: var(--muted); font-size: 12px; }
  .body { padding: 14px 24px 8px; overflow: auto; display: flex; flex-direction: column; gap: 16px; }
  .foot { display: flex; gap: 8px; justify-content: flex-end; align-items: center; padding: 14px 24px 18px; border-top: 1px solid var(--line); margin-top: 8px; }
  .foot .fill { margin-right: auto; color: var(--muted); font-size: 12px; }
  p { margin: 0; } .lead { font-size: 14px; line-height: 1.55; } .lead b { font-weight: 650; font-variant-numeric: tabular-nums; }
  .muted { color: var(--muted); } .small { font-size: 12px; }
  h3 { margin: 0 0 6px; font-size: 13px; font-weight: 650; }

  /* Buttons */
  .btn { height: 32px; padding: 0 14px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid #CBD0D7;
    background: #fff; color: var(--text); transition: background .1s ease; }
  .btn:hover { background: var(--well); }
  .btn.primary { background: var(--ink); border-color: var(--ink); color: #fff; }
  .btn.primary:hover { background: var(--ink-hover); }
  .btn.danger { background: var(--err); border-color: var(--err); color: #fff; } .btn.danger:hover { filter: brightness(.92); }
  .btn:disabled { opacity: .45; cursor: default; }
  .btn:focus-visible, input:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }

  /* Notices */
  .notice { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 8px; background: var(--warn-bg); color: var(--warn); }
  .notice.err { background: var(--err-bg); color: var(--err); } .notice.info { background: var(--well); color: var(--text); }
  .notice svg { width: 16px; height: 16px; flex: none; margin-top: 1px; }

  /* Options */
  .opt { display: flex; gap: 10px; align-items: flex-start; padding: 6px 0; cursor: pointer; }
  .opt input { margin: 2px 0 0; width: 15px; height: 15px; flex: none; accent-color: var(--ink); cursor: pointer; }
  .opt .t { display: block; font-weight: 550; }
  .opt .q { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--muted); font-size: 12px; }

  /* Question table: structure only where it carries information */
  .tablewrap { max-height: 236px; overflow: auto; border: 1px solid var(--line); border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; font-variant-numeric: tabular-nums; }
  th { position: sticky; top: 0; background: #fff; text-align: left; font-weight: 550; color: var(--muted); font-size: 12px; padding: 7px 12px; border-bottom: 1px solid var(--line); }
  td { padding: 6px 12px; border-bottom: 1px solid #F0F1F3; } tr:last-child td { border-bottom: 0; }
  .choice { display: block; width: 100%; text-align: left; margin: 0 0 8px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 8px; background: #fff; font: inherit; color: inherit; cursor: pointer; }
  .choice:hover:not(:disabled) { border-color: var(--ink); }
  .choice.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: default; } .choice.row:hover { border-color: var(--line); }
  .choice:disabled { cursor: default; opacity: .6; }
  .choice .t { display: block; font-weight: 600; } .choice .q { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; }
  details { margin-top: 10px; } summary { cursor: pointer; color: var(--muted); font-size: 12px; }
  pre { margin: 8px 0 0; padding: 10px 12px; max-height: 160px; overflow: auto; background: #F7F8FA; border: 1px solid var(--line); border-radius: 8px; font: 11.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; }
  input[type=number], input[type=text], select { height: 28px; padding: 0 8px; border: 1px solid #CBD0D7; border-radius: 6px; font: inherit; font-size: 12.5px; color: var(--ink); background: #fff; }
  input[type=number] { width: 64px; text-align: right; font-variant-numeric: tabular-nums; }
  td input[type=number] { height: 24px; width: 58px; padding: 0 6px; }
  .tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 8px; font-size: 12.5px; color: var(--muted); }
  .mv { width: 22px; height: 22px; padding: 0; border: 1px solid transparent; border-radius: 5px; background: none; color: var(--muted); font: inherit; line-height: 1; cursor: pointer; }
  .mv:hover:not(:disabled) { border-color: #CBD0D7; color: var(--ink); } .mv:disabled { opacity: .3; cursor: default; }
  .dest { margin: 0 0 4px; } .dest .fields { display: flex; gap: 8px; margin: 2px 0 6px 25px; flex-wrap: wrap; }
  tr.grp td { background: #F7F8FA; font-weight: 550; border-bottom: 1px solid var(--line); }
  td.indent { padding-left: 22px; }
  .srcname { font-weight: 650; }
  .linkbtn { margin-left: 6px; padding: 0; border: 0; background: none; font: inherit; font-size: 12px; font-weight: 500; color: var(--muted); text-decoration: underline; cursor: pointer; }
  .linkbtn:hover { color: var(--ink); }
  .tablewrap.tall { max-height: 360px; }
  td.pick, th.pick { width: 34px; padding-right: 0; }
  td.pick input, th.pick input { margin: 0; width: 15px; height: 15px; accent-color: var(--ink); cursor: pointer; vertical-align: middle; }
  .qhead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  td.num, th.num { text-align: right; width: 64px; }
  .ans { display: inline-block; min-width: 18px; padding: 0 5px; text-align: center; font-weight: 650;
    background: linear-gradient(transparent 14%, var(--hl) 14%, var(--hl) 92%, transparent 92%); border-radius: 2px; }
  .flag-warn { color: var(--warn); font-weight: 550; } .flag-err { color: var(--err); font-weight: 550; }

  /* Progress */
  .progress { display: flex; flex-direction: column; gap: 8px; }
  .bar { height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; }
  .bar i { display: block; height: 100%; width: 0; background: var(--ink); transition: width .2s ease; }

  @media (prefers-reduced-motion: reduce) { .overlay.enter, .overlay.enter .panel { animation: none; } .fab, .bar i, .btn { transition: none; } }
  `;

  // ---- DOM helpers ----------------------------------------------------------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
    });
    kids.flat(Infinity).forEach((c) => { if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return el;
  }

  const NS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    kids.forEach((k) => el.append(k));
    return el;
  }

  /** Mounts an isolated container once per page; returns { host, shadow }. */
  function mount(id) {
    const old = document.getElementById(id);
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = id;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(h('style', {}, CSS));
    document.documentElement.append(host);
    return { host, shadow };
  }

  // ---- brand mark: a snippet of a bubble sheet (same drawing as icons/logo.svg) ----
  function logo() {
    const ring = (cx, cy) => s('circle', { cx, cy, r: 12.5, fill: 'none', stroke: '#2B2F36', 'stroke-width': 5.5 });
    const dot = (cx, cy) => s('circle', { cx, cy, r: 15.25, fill: '#2B2F36' });
    return s('svg', { class: 'mark', viewBox: '0 0 128 128', 'aria-hidden': 'true' },
      s('rect', { width: 128, height: 128, rx: 28, fill: '#FFD84A' }),
      ring(30, 46), dot(64, 46), ring(98, 46), ring(30, 82), ring(64, 82), dot(98, 82));
  }

  const ICONS = {
    alert: [['path', { d: 'M8 2.3 14.3 13H1.7Z' }], ['path', { d: 'M8 6.6v3' }], ['path', { d: 'M8 11.4v.01' }]],
    info: [['circle', { cx: 8, cy: 8, r: 6.2 }], ['path', { d: 'M8 7.4v3.6' }], ['path', { d: 'M8 5v.01' }]],
  };
  function icon(name) {
    return s('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
      ...ICONS[name].map(([tag, attrs]) => s(tag, attrs)));
  }

  // ---- components -------------------------------------------------------------
  /** kind: 'warn' | 'err' | 'info' */
  const notice = (kind, text) => h('div', { class: 'notice ' + (kind === 'warn' ? '' : kind), role: kind === 'err' ? 'alert' : null }, icon(kind === 'info' ? 'info' : 'alert'), h('span', {}, text));

  /** variant: 'primary' | 'secondary' */
  const button = (label, opts) => {
    const o = opts || {};
    return h('button', { class: 'btn' + (o.variant === 'primary' ? ' primary' : '') + (o.variant === 'danger' ? ' danger' : ''), type: 'button', onclick: o.onclick, disabled: !!o.disabled }, label);
  };

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

  /** "32 questions worth 100 points, with 4 figures and 12 equations." as one readable sentence. */
  function summary(r) {
    const num = (n, one, many) => [h('b', {}, String(n)), ' ' + (n === 1 ? one : (many || one + 's'))];
    const extras = [];
    if (r.images) extras.push(num(r.images, 'figure'));
    if (r.equations) extras.push(num(r.equations, 'equation'));
    const tail = extras.length ? [', with ', extras[0], extras[1] ? [' and ', extras[1]] : null] : [];
    return h('p', { class: 'lead' }, num(r.supported, 'question'), ' worth ', h('b', {}, String(r.points)), ' ' + (r.points === 1 ? 'point' : 'points'), tail, '.');
  }

  /**
   * Render options for a failure: what happened in plain words, what to try, and a one-click
   * "Copy diagnostics". opts: { error, step, extra, actions }. Pass the result to dialog.render().
   */
  function failureView(opts) {
    const E = root.gs2canvasErrors;
    const ex = E.explain(opts.error);
    const text = E.diagnostics({ step: opts.step, error: opts.error, extra: opts.extra });
    const details = h('details', {}, h('summary', {}, 'What gets copied'), h('pre', {}, text));
    const copy = button('Copy diagnostics', { onclick: async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; }
      catch (e) { details.open = true; copy.textContent = 'Select the text below to copy'; }
      setTimeout(() => { copy.textContent = 'Copy diagnostics'; }, 2500);
    } });
    return { title: opts.title || ex.title, body: [notice('err', ex.message), h('p', { class: 'muted' }, ex.hint), details], actions: [copy].concat(opts.actions || []) };
  }

  /** The launcher tab: logo + label. */
  const launcher = (label, onclick) => h('button', { class: 'fab', type: 'button', onclick, title: label }, logo(), h('span', {}, label));

  /**
   * One dialog per content script. render() swaps the contents in place (no flicker between states).
   * Esc and clicking outside close it unless `locked` (while work is in progress).
   */
  function dialog(shadow) {
    let overlay = null; let locked = false;
    const close = () => { if (overlay) { overlay.remove(); overlay = null; } };
    function render(o) {
      const fresh = !overlay;
      locked = !!o.locked;
      const panel = h('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs2c-title', tabindex: '-1' },
        h('div', { class: 'head' }, logo(), h('div', {}, h('h2', { id: 'gs2c-title' }, o.title), o.subtitle ? h('p', { class: 'sub' }, o.subtitle) : null)),
        h('div', { class: 'body' }, ...(o.body || [])),
        o.actions && o.actions.length ? h('div', { class: 'foot' }, ...o.actions) : null);
      if (!overlay) {
        overlay = h('div', { class: 'overlay enter',
          onclick: (e) => { if (e.target === overlay && !locked) close(); },
          onkeydown: (e) => { if (e.key === 'Escape' && !locked) { e.stopPropagation(); close(); } } });
        shadow.append(overlay);
      }
      overlay.replaceChildren(panel);
      if (fresh) panel.focus();
    }
    return { render, close, get isOpen() { return !!overlay; } };
  }

  root.gs2canvasUI = { h, mount, logo, launcher, dialog, notice, button, summary, plural, failureView };
})(typeof window !== 'undefined' ? window : globalThis);
