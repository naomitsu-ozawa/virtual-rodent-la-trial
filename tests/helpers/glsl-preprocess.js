// Minimal conditional-compilation pass for the VR fragment shader text: evaluates #ifdef / #ifndef / #else / #endif for a set of defined names (the shader uses no #if expressions), drops the comments and
// collapses whitespace. Two shader texts that give the same result for a define set compile to the same program (used by the "child code is compiled out" guard).
export function shaderTemplate(vrViewSource) {
  const a = vrViewSource.indexOf('const fragmentShader=`'), b = vrViewSource.indexOf('`;', a);
  if (a < 0 || b < 0) throw new Error('fragmentShader template not found');
  return vrViewSource.slice(a + 'const fragmentShader=`'.length, b);
}
export function preprocess(text, defined) {
  const out = [], stack = []; // each: {on, taken, parentOn}
  const on = () => stack.every(s => s.on);
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    let m;
    if ((m = /^#ifdef\s+(\w+)/.exec(l))) { const v = defined.has(m[1]); stack.push({ on: v, taken: v }); continue; }
    if ((m = /^#ifndef\s+(\w+)/.exec(l))) { const v = !defined.has(m[1]); stack.push({ on: v, taken: v }); continue; }
    if (/^#else\b/.test(l)) { const s = stack[stack.length - 1]; s.on = !s.taken; s.taken = true; continue; }
    if (/^#endif\b/.test(l)) { stack.pop(); continue; }
    if (!on()) continue;
    out.push(raw.replace(/\/\/.*$/, '').trim());
  }
  return out.filter(Boolean).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/[ \t]+/g, ' ');
}
