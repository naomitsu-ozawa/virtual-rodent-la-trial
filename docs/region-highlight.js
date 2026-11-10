export const HIGHLIGHT_WHITE_MIX = 0.45; // the highlighted result's colour moves this far toward white
export const HIGHLIGHT_DIM_MIX = 0.35; // every other result's colour moves this far back toward its segment's colour

const mix = (a, b, t) => a + (b - a) * t;

// colour of one table texel. rgb / base: [r,g,b] (the result's colour and its segment's colour, the table's colour space).
// target: 'none' (no highlight: the colour is returned unchanged), 'on' (the highlighted result), 'other'.
export function highlightColor(rgb, base, target) {
  if (target === 'on') return [mix(rgb[0], 1, HIGHLIGHT_WHITE_MIX), mix(rgb[1], 1, HIGHLIGHT_WHITE_MIX), mix(rgb[2], 1, HIGHLIGHT_WHITE_MIX)];
  if (target === 'other' && base) return [mix(rgb[0], base[0], HIGHLIGHT_DIM_MIX), mix(rgb[1], base[1], HIGHLIGHT_DIM_MIX), mix(rgb[2], base[2], HIGHLIGHT_DIM_MIX)];
  return [rgb[0], rgb[1], rgb[2]];
}

// The highlight applies only to a result that exists and is SHOWN; otherwise (0, unknown, hidden: nothing is highlighted) the table is the plain one.
// entries: [{rid, shown}] in table order (texel i + 1). Returns the entry position to highlight, or -1.
export function highlightIndex(entries, rid) {
  if (!rid) return -1;
  const i = entries.findIndex(e => e.rid === rid);
  return i >= 0 && entries[i].shown ? i : -1;
}

// Which result is highlighted, from what the lasers point at. One tracker per session.
// update(hands, enabled): hands = [{key, pin, hover}] (key: any stable id of the hand / controller; pin: the region id of the pinned label the laser is on or holds, or 0;
// hover: the region id of the result under the laser whose name card is shown, or 0). Returns the region id to highlight (0 = none).
// Rules: a pinned label wins over a volume hover; of two hands of the same kind the one whose target changed last wins; nothing when disabled (analysis mode off),
// when a hand is gone (its laser vanished), or when nothing is pointed at. Never remembers a target the inputs no longer give (no sticky state).
export function createHighlightTracker() {
  const st = new Map(); // key -> {kind, rid, seq}
  let seq = 0;
  return {
    update(hands, enabled) {
      const alive = new Set();
      let best = null;
      for (const h of hands || []) {
        alive.add(h.key);
        const kind = h.pin ? 2 : h.hover ? 1 : 0, rid = kind === 2 ? h.pin : kind === 1 ? h.hover : 0;
        let s = st.get(h.key);
        if (!s) { s = { kind: 0, rid: 0, seq: 0 }; st.set(h.key, s); }
        if (s.kind !== kind || s.rid !== rid) { s.kind = kind; s.rid = rid; s.seq = ++seq; }
        if (enabled && kind && (!best || kind > best.kind || kind === best.kind && s.seq > best.seq)) best = s;
      }
      for (const k of [...st.keys()]) if (!alive.has(k)) st.delete(k);
      return best ? best.rid : 0;
    },
    reset() { st.clear(); },
  };
}
