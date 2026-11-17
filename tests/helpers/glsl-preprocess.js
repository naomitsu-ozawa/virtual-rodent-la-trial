import { PART_GLSL } from '../../docs/vr-part-view.js';
// Minimal conditional-compilation pass for the VR fragment shader text: evaluates #ifdef / #ifndef / #else / #endif for a set of defined names (the shader uses no #if expressions; a bare #define NAME adds to the set), drops the comments and
// collapses whitespace. Two shader texts that give the same result for a define set compile to the same program (used by the "child code is compiled out" guard).
export function shaderTemplate(vrViewSource) {
  const a = vrViewSource.indexOf('const fragmentShader=`'), b = vrViewSource.indexOf('`;', a);
  if (a < 0 || b < 0) throw new Error('fragmentShader template not found');
  // an earlier change: the one interpolation of the template that adds shader text (the detached part's block, all under #ifdef VRL_PART) is resolved, so that a program without VRL_PART hashes as it did before the block existed
  return vrViewSource.slice(a + 'const fragmentShader=`'.length, b).replace('${PART_GLSL}', PART_GLSL);
}
export function preprocess(text, defined0) {
  const out = [], stack = []; // each: {on, taken, parentOn}
  const defined = new Set(defined0); // a bare '#define NAME' inside an active block defines NAME for the lines after it (the shader makes VRL_HIDE that way, an earlier change); the line itself stays in the output
  const on = () => stack.every(s => s.on);
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    let m;
    if ((m = /^#define\s+(\w+)\s*$/.exec(l)) && on()) defined.add(m[1]);
    if ((m = /^#ifdef\s+(\w+)/.exec(l))) { const v = defined.has(m[1]); stack.push({ on: v, taken: v }); continue; }
    if ((m = /^#ifndef\s+(\w+)/.exec(l))) { const v = !defined.has(m[1]); stack.push({ on: v, taken: v }); continue; }
    if (/^#else\b/.test(l)) { const s = stack[stack.length - 1]; s.on = !s.taken; s.taken = true; continue; }
    if (/^#endif\b/.test(l)) { stack.pop(); continue; }
    if (!on()) continue;
    out.push(raw.replace(/\/\/.*$/, '').trim());
  }
  return out.filter(Boolean).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/[ \t]+/g, ' ');
}
