// チュートリアル voice player (VR board + 2D panel). Plain `new Audio(src)` (never fetch: the public gate inspects fetch); a missing file fails silently
// (the subtitles / texts carry the tutorial alone).: two voices, docs/tutorial/audio/<F1|M1>/<id>.m4a (F1 女性 = default, M1 男性); settings tutorialVoice 'off' = silent (subtitles only), anything else = F1.
export const AUDIO_BASE = './tutorial/audio/';
export const DEFAULT_VOICE = 'F1';
const AUDIO_QUERY = '?v=20261029-build689'; // same cache-busting form as the other assets (tools/bump-build.mjs rewrites it); the .m4a file name / id is unchanged
export const VOICES = Object.freeze(['F1', 'M1']);
export const voiceOf = v => (v === 'off' ? 'off' : VOICES.includes(v) ? v : DEFAULT_VOICE);
export const audioSrc = (voice, id, base = AUDIO_BASE) => { const v = voiceOf(voice); return !id || v === 'off' ? null : `${base}${v}/${id}.m4a${AUDIO_QUERY}`; };
// ids to speak for one engine snapshot, in order: the earned feedback first (stepClear: ok1..3; missionClear / allClear, each followed by its `then` line:, 「次へ」を押してください / the end), then the new step's own voice.
// prev = what was last announced ({mission, step, finished}); returns {ids, key}; ids = [] when nothing changed (counts inside a step do not speak).
export function speechFor(snap, step, prevKey) {
  const key = snap && snap.mission ? `${snap.mission}:${snap.step}:${snap.finished ? 1 : 0}` : '';
  const ids = [];
  if (snap && snap.feedbackItem && snap.feedbackItem.audio) { ids.push(snap.feedbackItem.audio); if (snap.feedbackItem.then && snap.feedbackItem.then.audio) ids.push(snap.feedbackItem.then.audio); }
  if (key && key !== prevKey && !snap.finished && step && step.audio) { ids.push(step.audio); if (step.then && step.then.audio) ids.push(step.then.audio); } // a page may carry a second clip (then)
  return { ids, key };
}
export function createTutorialAudio({ getVoice = () => DEFAULT_VOICE, AudioCtor = globalThis.Audio, base = AUDIO_BASE } = {}) {
  let cur = null, seq = 0, curList = null, curIdx = -1;
  const stop = () => { seq++; const a = cur; cur = null; curList = null; curIdx = -1; if (a) { try { a.pause(); } catch { /* */ } try { a.onended = a.onerror = null; } catch { /* */ } } };
  // plays the ids one after another (a missing file is skipped); a new call stops the previous one. onEnd (optional) runs once when the last clip has ended (or failed) and nothing
  // replaced the list meanwhile; it does not run when play returns false (no voice: the caller knows) or the list was stopped
  function play(ids, onEnd) {
    stop();
    const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean), v = voiceOf(getVoice()), my = seq;
    if (v === 'off' || !list.length || typeof AudioCtor !== 'function') return false;
    curList = list;
    const go = i => {
      if (my !== seq) return;
      if (i >= list.length) { if (typeof onEnd === 'function') { try { onEnd(); } catch { /* */ } } return; }
      curIdx = i;
      let a; try { a = new AudioCtor(audioSrc(v, list[i], base)); } catch { go(i + 1); return; }
      cur = a; let fired = false; const nxt = () => { if (fired) return; fired = true; if (my === seq) go(i + 1); }; // error + reject (or ended) both land here: advance once per clip
      a.onended = nxt; a.onerror = nxt;
      try { const p = a.play(); if (p && typeof p.catch === 'function') p.catch(nxt); } catch { nxt(); }
    };
    go(0); return true;
  }
  // the session ends: a clip that is playing / waiting and satisfies keep(id) (the earned ✓ feedback: ok1..3 / mclear / allclear) plays to its end, the guidance voice is cut as before.
  // The clip playing now must be a kept one (else everything stops); of the clips still waiting only the kept ones stay.
  function settle(keep) {
    const l = curList, i = curIdx;
    if (!l || !cur || i < 0 || typeof keep !== 'function' || !keep(l[i])) { stop(); return false; }
    l.splice(i + 1, l.length, ...l.slice(i + 1).filter(keep)); return true;
  }
  return { play, stop, settle };
}
export const isFeedbackId = id => /^(ok[123]|mclear|allclear|gonext)$/.test(id || '');
// the ids of a page's voice, in order (audio, then its second clip)
export const stepVoiceIds = s => (s && s.audio ? [s.audio, ...(s.then && s.then.audio ? [s.then.audio] : [])] : []);
// no progress for the step's timeoutHint ms -> its voice again, once per quiet period (reset(now) on every progress / page change; tick(now) from the frame loop)
export function createStepReplay(onReplay) {
  let at = 0, hint = 0, armed = false;
  return {
    reset(now, timeoutHint) { at = now; hint = timeoutHint > 0 ? timeoutHint : 0; armed = hint > 0; },
    stop() { armed = false; },
    tick(now) { if (armed && now - at >= hint) { armed = false; try { onReplay(); } catch { /* */ } return true; } return false; },
  };
}
// the success sound (a short two-note chime, made with Web Audio: no file) that goes with the ✓ when a page of a step is done. Silent when the voice setting is
// 'off' or there is no AudioContext (tests, old browsers); one context, made on the first chime. Returns true when a chime was started.
export const CHIME_NOTES = Object.freeze([[1046.5, 0, 0.12], [1568, 0.09, 0.22]]); // [Hz, start s, length s]: C6 then G6
export function createChime({ getVoice = () => DEFAULT_VOICE, Ctx = globalThis.AudioContext || globalThis.webkitAudioContext, gain = 0.18 } = {}) {
  let ctx = null;
  return {
    play() {
      if (voiceOf(getVoice()) === 'off' || typeof Ctx !== 'function') return false;
      try {
        ctx ||= new Ctx(); if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
        const t0 = ctx.currentTime + 0.01;
        for (const [hz, at, len] of CHIME_NOTES) {
          const o = ctx.createOscillator(), g = ctx.createGain(), s = t0 + at;
          o.type = 'sine'; o.frequency.setValueAtTime(hz, s);
          g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(gain, s + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, s + len);
          o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + len + 0.02);
        }
        return true;
      } catch { return false; }
    },
    close() { try { ctx?.close?.(); } catch { /* */ } ctx = null; },
  };
}
