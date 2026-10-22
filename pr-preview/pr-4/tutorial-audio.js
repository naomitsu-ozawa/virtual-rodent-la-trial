// チュートリアル voice player (VR board + 2D panel). Plain `new Audio(src)` (never fetch: the public gate inspects fetch); a missing file fails silently
// (the subtitles / texts carry the tutorial alone). One female voice only (user decision): docs/tutorial/audio/F1/<id>.m4a; settings tutorialVoice 'off' = silent (subtitles only), anything else = F1.
export const AUDIO_BASE = './tutorial/audio/';
export const DEFAULT_VOICE = 'F1';
const AUDIO_QUERY = '?v=20261022-build643'; // same cache-busting form as the other assets (tools/bump-build.mjs rewrites it); the .m4a file name / id is unchanged
export const voiceOf = v => (v === 'off' ? 'off' : DEFAULT_VOICE);
export const audioSrc = (voice, id, base = AUDIO_BASE) => (!id || voiceOf(voice) === 'off' ? null : `${base}${DEFAULT_VOICE}/${id}.m4a${AUDIO_QUERY}`);
// ids to speak for one engine snapshot, in order: the earned feedback first (stepClear: ok1..3; missionClear / allClear), then the new step's own voice.
// prev = what was last announced ({mission, step, finished}); returns {ids, key}; ids = [] when nothing changed (counts inside a step do not speak).
export function speechFor(snap, step, prevKey) {
  const key = snap && snap.mission ? `${snap.mission}:${snap.step}:${snap.finished ? 1 : 0}` : '';
  const ids = [];
  if (snap && snap.feedbackItem && snap.feedbackItem.audio) ids.push(snap.feedbackItem.audio);
  if (key && key !== prevKey && !snap.finished && step && step.audio) ids.push(step.audio);
  return { ids, key };
}
export function createTutorialAudio({ getVoice = () => DEFAULT_VOICE, AudioCtor = globalThis.Audio, base = AUDIO_BASE } = {}) {
  let cur = null, seq = 0, curList = null, curIdx = -1;
  const stop = () => { seq++; const a = cur; cur = null; curList = null; curIdx = -1; if (a) { try { a.pause(); } catch { /* */ } try { a.onended = a.onerror = null; } catch { /* */ } } };
  // plays the ids one after another (a missing file is skipped); a new call stops the previous one
  function play(ids) {
    stop();
    const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean), v = voiceOf(getVoice()), my = seq;
    if (v === 'off' || !list.length || typeof AudioCtor !== 'function') return false;
    curList = list;
    const go = i => {
      if (my !== seq || i >= list.length) return;
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
export const isFeedbackId = id => /^(ok[123]|mclear|allclear)$/.test(id || '');
// no progress for the step's timeoutHint ms -> its voice again, once per quiet period (reset(now) on every progress / page change; tick(now) from the frame loop)
export function createStepReplay(onReplay) {
  let at = 0, hint = 0, armed = false;
  return {
    reset(now, timeoutHint) { at = now; hint = timeoutHint > 0 ? timeoutHint : 0; armed = hint > 0; },
    stop() { armed = false; },
    tick(now) { if (armed && now - at >= hint) { armed = false; try { onReplay(); } catch { /* */ } return true; } return false; },
  };
}
