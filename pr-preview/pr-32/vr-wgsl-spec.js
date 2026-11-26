// WebGPU (WGSL) volume pass, the "specialised" program (A4): the settings that do not change from frame to frame (the debug view, the surface search, the jump / creep switches, the processing-mask bits,
// the channel and the simple flag of each of the four segment slots, the content box's entry flag, the cap switch, the number of section planes and which of them clip) are WGSL `override` constants, given when the pipeline is made (GPUProgrammableStage.constants), instead of members of the uniform buffer.
// The text is the display variant's (docs/vr-wgsl-core.js volumeWgsl) with exact substitutions, like the breakdown's `ablate`: every anchor must occur exactly the expected number of times, else this throws (so a change of
// the core's text can never silently leave a uniform read behind). The core is not touched; nothing here runs unless the host asks (the breakdown's specCfg shadow pass is the only user).
// What is the same: every expression that reads one of these values is the display's own expression with the uniform read replaced by the constant (the one-hot selectors are the same vectors, built by kSel / kOff from the constants),
// so the result is the same bit for bit when the generic and the specialised pass run with the same values (the performance record's 'specCfg' comparison counts the pixels that differ: expected 0).
// What is NOT specialised (continuous values, flags that are tests on a continuous value, and per-pass values): stepSize, texDims, halfExt, calib, voxelSize, boxC / boxH (the content box's size; its test boxH.x > 0 reads a float that is also used in arithmetic),
// segA x y z (thresholds, alpha), segC rgb, segM, ctShade / ctShadeBright / ctShadeContrast / ctShadeRange, cutPlanes, sliceWindow / sliceAir / sliceTint / sliceOpacity / sliceSegOnly (tests on floats that the slice code also uses as values; section variant only),
// proxyOn / proxyOrg (differ per pass and per eye), mvp / origin / lightOff (per eye and frame). A folded division / pow / normalize could round differently from the run-time one.
import { volumeWgsl, uniformLayout } from './vr-wgsl-core.js?v=20261126-build767';

// the code constant of the display switch (the diagnostics' / the page's choice comes later): false = the display always uses the generic program, true = the display uses the specialised program of its
// current settings as soon as it is made (the generic program draws until then), see createVolumeGpu({ specDisplay }) in docs/vr-wgpu.js

// the signature of a pass's settings: 18 integers (canonical, see specSig*), in this order; the override of each
export const SPEC_FIELDS = ['diag', 'refine', 'useSkip', 'jumpOn', 'editMask', 'editMaskOnly', 'ch0', 'ch1', 'ch2', 'ch3', 'simple0', 'simple1', 'simple2', 'simple3', 'boxEntry', 'capOn', 'planeCount', 'planeCut'];
export const SPEC_OVERRIDES = ['K_DIAG', 'K_REFINE', 'K_SKIP', 'K_JUMP', 'K_EDIT', 'K_EDITONLY', 'K_CH0', 'K_CH1', 'K_CH2', 'K_CH3', 'K_SIM0', 'K_SIM1', 'K_SIM2', 'K_SIM3', 'K_BOXENT', 'K_CAP', 'K_PLANES', 'K_PLANECUT'];
export const SPEC_LEN = SPEC_FIELDS.length;
const SEGS = 4;

// ---- the signature (the part of the pass's uniforms that is made constant) ----
// A slot is "usable" when it is shown (segA.w > 0.5) and has a class channel 0..3: the shader's selectors, offsets and loops treat every other slot alike (its channel is never read), so an unusable slot's channel is -1 and its simple flag 0.
// The mask bits are those of the four slots (the shader shifts by 0..3 only); the plane count is 0..10 (the loops stop there) and the clip bits are those of the ten planes.
const num = v => (v === undefined || v === null ? 0 : v | 0); // the packer's own reading of a missing value: the buffer stays 0
const pick = (v, i, k) => (v === undefined || v === null ? 0 : (v[k] ?? v[i] ?? 0)); // a vector's component the way the packer reads it (x ?? [0])
// from the values a pass would pack: get(name) = the extra / override value of the pass, else the session's uniform value (fillUniforms of docs/vr-wgpu.js)
export function specSigFrom(get, out = new Int32Array(SPEC_LEN)) {
  out[0] = num(get('diag')); out[1] = num(get('refine')); out[2] = num(get('useSkip')); out[3] = num(get('jumpOn'));
  out[4] = num(get('editMask')) & 15; out[5] = num(get('editMaskOnly')) & 15;
  const chan = get('clsChan'), segA = get('segA'), segC = get('segC');
  for (let s = 0; s < SEGS; s++) {
    const c = pick(chan, s, ['x', 'y', 'z', 'w'][s]) | 0, a = segA?.[s], w = a ? +(a.w ?? a[3] ?? 0) : 0, usable = w > 0.5 && c >= 0 && c <= 3;
    const cw = segC?.[s], sw = cw ? +(cw.w ?? cw[3] ?? 0) : 0;
    out[6 + s] = usable ? c : -1;
    out[10 + s] = usable && sw > 0.5 ? 1 : 0;
  }
  out[14] = num(get('boxEntry')); out[15] = num(get('capOn')); out[16] = Math.min(10, Math.max(0, num(get('planeCount')))); out[17] = num(get('planeCut')) & 1023;
  return out;
}
// the same from the session's uniforms object and the pass's extra values (what drawPass packs: extra = passExtra + overrides, else u[name].value)
export const specSigOfUniforms = (u, extra = null, out) => specSigFrom(n => (extra && n in extra ? extra[n] : u[n]?.value), out);
// the same from a packed uniform buffer (the snapshot of the breakdown): i32 / f32 = two views of the same bytes, layout = uniformLayout()
export function specSigOfPacked(i32, f32, layout = uniformLayout(), out) {
  const at = n => layout.fields.find(f => f.name === n);
  const cc = at('clsChan'), sa = at('segA'), sc = at('segC');
  const i = n => i32[at(n).offset / 4];
  return specSigFrom(n => {
    if (n === 'clsChan') return [i32[cc.offset / 4], i32[cc.offset / 4 + 1], i32[cc.offset / 4 + 2], i32[cc.offset / 4 + 3]];
    if (n === 'segA') return [0, 1, 2, 3].map(s => [0, 0, 0, f32[sa.offset / 4 + s * sa.stride / 4 + 3]]);
    if (n === 'segC') return [0, 1, 2, 3].map(s => [0, 0, 0, f32[sc.offset / 4 + s * sc.stride / 4 + 3]]);
    return i(n);
  }, out);
}
// the constants the pipeline is made with ({ K_DIAG: 0, ... }) and the key that tells two pipelines apart
export function specConstants(sig) { const o = {}; for (let i = 0; i < SPEC_LEN; i++) o[SPEC_OVERRIDES[i]] = sig[i]; return o; }
export const specKey = sig => Array.prototype.join.call(sig, '.');

// ---- the text ----
const sub = (t, re, to, n, what) => {
  const k = [...t.matchAll(re.global ? re : new RegExp(re.source, re.flags + 'g'))].length;
  if (k !== n) throw new Error('volumeSpecWgsl: ' + what + ' found ' + k + ' times, expected ' + n);
  return t.replace(re, to);
};
// text of the display variant -> text of the specialised variant (f16 is read from the text: `enable f16;` on its first line)
export function specializeVolumeWgsl(t) {
  const f16 = t.startsWith('enable f16;'), FM = f16 ? 'f16' : 'f32', FM4 = 'vec4<' + FM + '>';
  // the one-hot selectors (var sel0..3 / off0..3 filled slot by slot) become expressions of the constants: the same vectors (a one at the slot's channel when the slot is shown, SEG_OFF as its offset otherwise)
  t = sub(t, / var sel0=[^\n]*\n(?: \{let c=u\.clsChan\[\d\];[^\n]*\}\}\n){4}/, ' ' + [0, 1, 2, 3].map(s => `let sel${s}=${FM4}(kSel(${s},0),kSel(${s},1),kSel(${s},2),kSel(${s},3));let off${s}=kOff(${s});`).join('') + '\n', 1, 'the selector block');
  t = sub(t, /u\.diag\b/g, 'K_DIAG', 6, 'u.diag');
  t = sub(t, /u\.refine\b/g, 'K_REFINE', 1, 'u.refine');
  t = sub(t, /u\.useSkip\b/g, 'K_SKIP', 1, 'u.useSkip');
  t = sub(t, /u\.jumpOn\b/g, 'K_JUMP', 1, 'u.jumpOn');
  t = sub(t, /u\.editMaskOnly\b/g, 'K_EDITONLY', 1, 'u.editMaskOnly');
  t = sub(t, /u\.editMask\b/g, 'K_EDIT', 2, 'u.editMask');
  const ev = t.includes('var crossT:array<f32,10>'); // the section variant reads the plane count three times and the clip bits once; the others read the plane count once (the slice look)
  t = sub(t, /u\.boxEntry\b/g, 'K_BOXENT', 1, 'u.boxEntry');
  t = sub(t, /u\.capOn\b/g, 'K_CAP', 1, 'u.capOn');
  t = sub(t, /u\.planeCount\b/g, 'K_PLANES', ev ? 3 : 1, 'u.planeCount');
  t = sub(t, /u\.planeCut\b/g, 'K_PLANECUT', ev ? 1 : 0, 'u.planeCut');
  t = sub(t, /u\.clsChan\[(\w+)\]/g, 'kChan($1)', 4, 'u.clsChan[...] (the first-slot test, the loops and the hit slot)'); // the four literal reads of the selector block are gone with it
  t = sub(t, /u\.segA\[(\w+)\]\.w>0\.5/g, 'kOn($1)', 3, 'u.segA[...].w>0.5');
  t = sub(t, /u\.segC\[(\w+)\]\.w>0\.5/g, 'kSimple($1)', 2, 'u.segC[...].w>0.5');
  const decl = SPEC_OVERRIDES.map(n => 'override ' + n + ':i32;').join('\n') + '\n'
    + 'fn kChan(s:i32)->i32{if(s==0){return K_CH0;}if(s==1){return K_CH1;}if(s==2){return K_CH2;}return K_CH3;}\n'
    + 'fn kOn(s:i32)->bool{return kChan(s)>=0;}\n'
    + 'fn kSimple(s:i32)->bool{if(s==0){return K_SIM0==1;}if(s==1){return K_SIM1==1;}if(s==2){return K_SIM2==1;}return K_SIM3==1;}\n'
    + `fn kSel(s:i32,c:i32)->${FM}{return select(${FM}(0.0),${FM}(1.0),kChan(s)==c);}\n`
    + `fn kOff(s:i32)->${FM}{return select(SEG_OFF,${FM}(0.0),kChan(s)>=0);}\n`;
  t = sub(t, /@group\(0\) @binding\(0\) var<uniform> u:U;\n/, m => m + decl, 1, 'the uniform declaration');
  return sub(t, /(\/\/ VR \/ AR volume pass \(WGSL\), variant [^\n]*)\n/, '$1 spec=cfg\n', 1, 'the header line');
}
export function volumeSpecWgsl({ f16 = false, cls4 = false, events = true } = {}) { return specializeVolumeWgsl(volumeWgsl({ f16, cls4, events })); }

// ---- the pipelines (made on the host's device; one program text per display variant, one pipeline per variant and signature) ----
// makeDesc(module, constants, variant) = the host's render pipeline descriptor of the module with the fragment stage's constants (the vertex stage has none: it reads no override)
// onBuild({ key, ms, ok, error }) = told when a pipeline's creation ended (ms = from the request to the pipeline being ready, which includes the driver's queue)
export function createSpecPipelines({ device, f16 = false, makeDesc, onShader = null, onBuild = null, max = 24, now = () => (globalThis.performance?.now?.() ?? Date.now()) }) {
  const modules = new Map(), pipes = new Map(), pending = new Map(), failed = new Set(), stats = { requested: 0, built: 0, failed: 0, ms: [], errors: [], lastKey: null };
  const vk = v => (v.cls4 ? 'c4' : 'c3') + (v.events ? 'e' : 'n');
  const keyOf = (v, sig) => vk(v) + '|' + specKey(sig);
  const moduleOf = v => {
    const k = vk(v); let m = modules.get(k);
    if (!m) {
      m = device.createShaderModule({ code: volumeSpecWgsl({ f16, cls4: !!v.cls4, events: !!v.events }) }); modules.set(k, m);
      try { onShader?.(m, { f16, cls4: !!v.cls4, events: !!v.events, spec: true }); } catch { /* diagnostics only */ }
    }
    return m;
  };
  // 'ready' | 'pending' | 'failed' | 'none'
  const status = (v, sig) => { const k = keyOf(v, sig); return pipes.has(k) ? 'ready' : pending.has(k) ? 'pending' : failed.has(k) ? 'failed' : 'none'; };
  const get = (v, sig) => { const k = keyOf(v, sig), p = pipes.get(k); if (p) { pipes.delete(k); pipes.set(k, p); } return p ?? null; }; // (a use makes it the newest)
  // starts the creation (asynchronously) unless it is made, being made or has failed; never throws
  const request = (v, sig) => {
    const k = keyOf(v, sig);
    if (pipes.has(k) || pending.has(k) || failed.has(k)) return;
    const constants = specConstants(sig), t0 = now();
    stats.requested++; stats.lastKey = k;
    let job;
    try { job = Promise.resolve(device.createRenderPipelineAsync(makeDesc(moduleOf(v), constants, v))); } catch (e) { job = Promise.reject(e); }
    pending.set(k, job);
    job.then(p => {
      pending.delete(k); pipes.set(k, p); stats.built++; const ms = now() - t0; if (stats.ms.length < 200) stats.ms.push(ms);
      while (pipes.size > max) pipes.delete(pipes.keys().next().value); // the oldest goes (a pipeline has no destroy: the garbage collector takes it)
      try { onBuild?.({ key: k, ms, ok: true }); } catch { /* the page's callback */ }
    }, e => {
      pending.delete(k); failed.add(k); stats.failed++; if (stats.errors.length < 3) stats.errors.push(k + ' ' + String(e?.message ?? e).slice(0, 160));
      try { onBuild?.({ key: k, ms: now() - t0, ok: false, error: String(e?.message ?? e).slice(0, 200) }); } catch { /* the page's callback */ }
    });
  };
  // the display's lookup: the specialised pipeline of this pass's settings when it is ready, else null (and its creation is started): the caller draws the generic program meanwhile
  const sigBuf = new Int32Array(SPEC_LEN);
  let lastSig = null, lastV = null, lastPipe = null;
  const pick = (v, u, extra) => {
    specSigOfUniforms(u, extra, sigBuf);
    if (lastPipe && lastV === vk(v) && sigBuf.every((x, i) => x === lastSig[i])) return lastPipe;
    const p = get(v, sigBuf);
    if (p) { lastSig = Int32Array.from(sigBuf); lastV = vk(v); lastPipe = p; return p; }
    lastPipe = null; request(v, sigBuf); return null;
  };
  // what happened before a recording began (builds made while the display switch was on, or in an earlier recording) goes to the recording's collector once: emit(name, a, b) = the breakdown's onShadow
  const replay = emit => {
    try { for (const ms of stats.ms) emit('specMs', ms, 1); for (const e of stats.errors) { emit('specFail', 0, 1); emit('specErr:' + e, 0, 1); } } catch { /* the page's callback */ }
  };
  return { status, get, request, pick, keyOf, stats, replay, size: () => pipes.size, sigOf: specSigOfUniforms };
}
