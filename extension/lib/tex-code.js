/**
 * Some instructors type code (e.g. SQL) as LaTeX math:
 *   \text{SELECT a} \\ \text{FROM t}
 * That should be a code block, not an equation picture. texToCode() recognises
 * exactly that shape and returns the code text; anything else returns null so
 * genuine math is never touched.
 */
(function (root) {
  const SQL_START = /^\s*\\text\{\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|WITH)\b/i;

  function texToCode(tex) {
    const hasBreak = tex.indexOf('\\\\') >= 0;
    if (!hasBreak && !SQL_START.test(tex)) return null;

    const lines = [];
    let cur = '';
    let pos = 0;
    const re = /\s*(?:\\text\{([^{}]*)\}|(\\\\)|(\\ ))\s*/y;
    while (pos < tex.length) {
      re.lastIndex = pos;
      const m = re.exec(tex);
      if (!m) return null; // something that isn't plain \text / line break: real math
      pos = re.lastIndex;
      if (m[1] !== undefined) {
        const t = m[1].replace(/\\([_%&#$])/g, '$1').replace(/`/g, "'");
        if (t.indexOf('\\') >= 0) return null;
        cur += t;
      } else if (m[2] !== undefined) {
        lines.push(cur); cur = '';
      } else {
        cur += ' ';
      }
    }
    lines.push(cur);
    const code = lines.map((l) => l.trim()).join('\n').trim();
    return code || null;
  }

  // Rewrite \( .. \) / \[ .. \] spans in neutral text whose body is code-as-math.
  function normalizeText(text) {
    return String(text).replace(/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g, (all, a, b) => {
      const code = texToCode(a !== undefined ? a : b);
      return code === null ? all : '\n```\n' + code + '\n```\n';
    }).replace(/\n{3,}/g, '\n\n').trim();
  }

  root.gs2canvasTexCode = { texToCode, normalizeText };
})(typeof window !== 'undefined' ? window : globalThis);
