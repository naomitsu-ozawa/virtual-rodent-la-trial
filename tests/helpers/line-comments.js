// Finds the `//` line comments of a JavaScript source (template-literal contents such as GLSL / WGSL included: a comment there swallows shader code the
// same way). Not a full tokenizer: strings are tracked per line, template literals across lines, block comments across lines.
// Skipped on purpose (not comments): `//` inside '...' / "..." strings (URLs), after `:` (scheme://), after `\` (the end of a regex like /\/\//), inside /* */.
// returns [{line (1-based), code (text before the //), text (the comment text)}]
export function lineComments(src) {
  const out = [], lines = src.split('\n');
  let state = 'code';
  for (let ln = 0; ln < lines.length; ln++) {
    const l = lines[ln]; let q = null;
    for (let i = 0; i < l.length; i++) {
      const c = l[i], n = l[i + 1];
      if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; i++; } continue; }
      const slashes = c === '/' && n === '/' && l[i - 1] !== ':' && l[i - 1] !== '\\';
      if (state === 'tpl') {
        if (c === '\\') { i++; continue; }
        if (c === '`') { state = 'code'; continue; }
        if (slashes) { out.push({ line: ln + 1, code: l.slice(0, i), text: l.slice(i + 2) }); break; }
        continue;
      }
      if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
      if (c === "'" || c === '"') { q = c; continue; }
      if (c === '`') { state = 'tpl'; continue; }
      if (c === '/' && n === '*') { state = 'block'; i++; continue; }
      if (slashes) { out.push({ line: ln + 1, code: l.slice(0, i), text: l.slice(i + 2) }); break; }
    }
  }
  return out;
}

// Does the comment look like it swallowed a statement? (build 474 / 481 / 436 accidents: an edit appended code after a `//` comment on the same line)
//  S1: a comment after code that ends with `;`        (`foo(); // note them scene.add(dot);`)
//  S2: `;` directly followed by a call or an assignment (`...them);c.userData.dot=dot;`), in any comment
//  S3: a lowercase letter glued to scene./ctx./mesh./c.userData. + a call (`themscene.add(`), in any comment (the build 474 shape)
// Prose with a trailing `;`, `a; b.c()` with a space, or a URL does not match.
export function swallowedStatement({ code, text }) {
  const t = text.trimEnd();
  if (code.trim() && t.endsWith(';')) return 'S1: a comment after code ends with ";"';
  if (/;[A-Za-z_$][\w$.[\]]*(?:\(|=[^=])/.test(t)) return 'S2: ";" directly followed by a call or assignment';
  if (/[a-z](?:scene|c\.userData|ctx|mesh)\.[A-Za-z]+\(/.test(t)) return 'S3: a word glued to scene./ctx./mesh. + call';
  return null;
}
