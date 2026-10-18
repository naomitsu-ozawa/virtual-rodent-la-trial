// GPU segment slots (build 531). The WebGPU volume shader, the VR shader and the classification / edit-mask data hold FOUR
// segment slots (WGSL / GLSL arrays, RGBA channels, 4-bit masks). With the fifth preset (contrast, 造影領域) the app has more
// presets than slots: at most GPU_SEGMENT_SLOTS of them may be enabled (shown) at once, and this module maps the enabled ones
// to slots 0..3. Pure (no DOM, no app state): the segment state is passed in.
//
// Rule: slot i holds order[i] (bone, soft, fat, lung) exactly as before build 531, so a project that never enables the extra
// preset gets the same slots (and the same shader input) as ever. An ENABLED preset beyond the first GPU_SEGMENT_SLOTS of the
// order (contrast) takes the slot of the first preset of the base that is not enabled. The result always has GPU_SEGMENT_SLOTS
// keys, so callers keep passing "the order" to the renderer / the data builders (they read slot i = key i).
// Future 5-at-once (N <= 8): raise GPU_SEGMENT_SLOTS together with the shaders / textures; nothing else here changes.
export const GPU_SEGMENT_SLOTS = 4;

const isOn = (state, key) => !!(state?.[key]?.active && state[key].enabled);

// order: every preset key (SEGMENT_PRESET_ORDER); state: {key: {active, enabled}} -> the keys of the slots 0..slots-1
export function gpuSlotOrder(order, state, slots = GPU_SEGMENT_SLOTS) {
  const out = order.slice(0, slots);
  for (const extra of order.slice(slots)) {
    if (!isOn(state, extra)) continue;
    const free = out.findIndex(k => !isOn(state, k));
    if (free >= 0) out[free] = extra; // no free slot: the refusal in canEnableSegment makes this unreachable; the extra stays unshown
  }
  return out;
}

// number of shown (active and enabled) presets
export function enabledSegmentCount(order, state) {
  let n = 0;
  for (const k of order) if (isOn(state, k)) n++;
  return n;
}

// may `key` be enabled now? (already enabled, or a slot is free)
export function canEnableSegment(order, state, key, slots = GPU_SEGMENT_SLOTS) {
  if (state?.[key]?.active && state[key].enabled) return true;
  return enabledSegmentCount(order, state) < slots;
}

// a string for cache keys: the slot assignment as the shaders see it
export function slotSignature(order, state, slots = GPU_SEGMENT_SLOTS) {
  return gpuSlotOrder(order, state, slots).join(',');
}
