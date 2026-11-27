// stage 3 (VR): the long-press ring of an analysis region / a child segment. Pure: no DOM, no three.js, unit-tested (tests/unit/region-ring.test.js).
// The laser on a region and / or a child segment + the trigger (or a hand's pinch) held = a ring right there with the same two toggles as the board's rows:
//   色   = the colouring only (region.visible, child.colorOff: off = the colour goes, the shape stays);
//   表示 = the shape (region.hidden, child.visible: off = the whole shape is hidden, what lies behind it shows).
// ONE target (a region or a child): two items, 色 left and 表示 right (vr-ring.js wheelAngles(2)); the target's name sits in the middle.
// A region AND a child under the laser at once (they overlap): four items, 領域の色 / 領域の表示 / 子の色 / 子の表示 (each says whose it is), the name of both in the middle. Layout: the top half = the region, the bottom half = the child; 色 left, 表示 right
// (upper left = the region's 色, upper right = its 表示, lower left = the child's 色, lower right = its 表示: vr-ring.js wheelAngles(4, quad)).
// The item states (on = lit) are what the user sees now: colour on, shape shown. Wording is fixed (never swapped with the state).
import { regionVisible, regionHidden } from './region-visibility.js?v=20261127-build773';

// the ids of the items (the same in the one-target and the two-target ring, so one confirm handles both)
export const RING_ITEM_IDS = Object.freeze(['rcolor', 'rshape', 'ccolor', 'cshape', 'rdetach', 'cdetach', 'pback']);

// reg: the page's analysis region or null; child: the page's child segment ({key, visible, colorOff}) or null -> {reg:{color,shape}|null, child:{color,shape}|null} (booleans: what is lit)
// seen (optional, an earlier change) = {reg: bool, child: bool}: the colour AS THE USER SEES it where the saved flag alone is not the whole story (VR: the stick's run-time colour-off blanks every colour, so the 色 item is unlit then). Omitted = the flags.
export function ringState(reg, child, seen = null) {
  return {
    reg: reg ? { color: seen && typeof seen.reg === 'boolean' ? seen.reg : regionVisible(reg), shape: !regionHidden(reg) } : null,
    child: child ? { color: seen && typeof seen.child === 'boolean' ? seen.child : child.colorOff !== true, shape: child.visible !== false } : null,
  };
}

// state = ringState(...); text = {color, shape, regionColor, regionShape, childColor, childShape, detach, regionDetach, childDetach} -> [{id, label, on, enabled}] ([] = nothing to ring: no target).
// an earlier change: 切り出す is the third item of every target (the laser's target is cut out as it is: nothing is chosen again); canDetach = false (a pair is shown) leaves it dark.
// ONE target: 3 items, 色 (lower left) / 表示 (lower right) / 切り出す (top): 色 left, 表示 right stay (vr-ring.js wheelAngles(3, quad) = 240, 120, 0).
// A region AND a child: 6 items, the top half = the region, bottom half = the child, 色 left, 表示 right: 領域の色 / 領域の表示 / 領域の切り出す / 子の色 / 子の表示 / 子の切り出す at 300, 60, 0 / 240, 120, 180
// (upper left, upper right, top / lower left, lower right, bottom: vr-ring.js wheelAngles(6, quad)).
export function regionRingItems(state, text, canDetach = true) {
  const mk = (id, label, on, enabled = true) => ({ id, label, on: !!on, enabled: !!enabled });
  const { reg, child } = state || {};
  if (reg && child) return [mk('rcolor', text.regionColor, reg.color), mk('rshape', text.regionShape, reg.shape), mk('rdetach', text.regionDetach, false, canDetach), mk('ccolor', text.childColor, child.color), mk('cshape', text.childShape, child.shape), mk('cdetach', text.childDetach, false, canDetach)];
  const one = reg || child;
  if (!one) return [];
  return [mk(reg ? 'rcolor' : 'ccolor', text.color, one.color), mk(reg ? 'rshape' : 'cshape', text.shape, one.shape), mk(reg ? 'rdetach' : 'cdetach', text.detach, false, canDetach)];
}
// the ring of a part that is out (long press on it): ONE item, 戻す (only that part goes back)
export const partRingItems = text => [{ id: 'pback', label: text.back, on: false, enabled: true }];

// the ring's centre text: the names of the targets (region first); one name when only one is there
export const regionRingName = (regName, childName) => [regName, childName].filter(Boolean).join(' / ');

// what a confirmed item does. ops = {setRegionVisible(region,on), setRegionHidden(region,on), setChildLook(key,{colorOff}|{visible}), detachRegion(region), detachChild(key), partBack()}; reg / child = the page's objects.
// ops.pressRegionColor(region) / ops.pressChildColor(key) (optional, VR): the 色 items go through them (the board's own press: it also ends the stick's colour-off, vr-view.js); without them the flags are toggled directly.
// ops.detachRegion / detachChild (VR, an earlier change): 切り出す takes THAT target out of the body as a part (no flag is written); ops.partBack: 戻す puts the part the ring belongs to back
// -> true when something was switched (a toggle of the same state is never sent)
export function applyRingItem(id, { reg, child }, ops) {
  if (id === 'rcolor' && reg) return ops.pressRegionColor ? !!ops.pressRegionColor(reg) : !!ops.setRegionVisible(reg, !regionVisible(reg));
  if (id === 'rshape' && reg) return !!ops.setRegionHidden(reg, !regionHidden(reg));
  if (id === 'ccolor' && child) return ops.pressChildColor ? !!ops.pressChildColor(child.key) : !!ops.setChildLook(child.key, { colorOff: child.colorOff !== true });
  if (id === 'cshape' && child) return !!ops.setChildLook(child.key, { visible: child.visible === false });
  if (id === 'rdetach' && reg) return !!ops.detachRegion?.(reg);
  if (id === 'cdetach' && child) return !!ops.detachChild?.(child.key);
  if (id === 'pback') return !!ops.partBack?.();
  return false;
}

// which targets a trigger target (resolveTriggerTarget's {kind, ref}) rings. The laser's volume hit ref = {id (1-based position in the prepared result list, 0 = none), childKey ('' = none), pair?, plane?}.
// kind: 'label' (解析 tab open), 'record' (a point would be recorded: only on the surface, never on a section's plane) and 'tissue' (section mode: the object's surface is in front of the plane) have a tissue hit;
// anything else, the partner's bone (ref.pair) and a plane hit give nothing. -> {regionId: list position or 0, childKey: '' | key} or null (no region and no child under the laser)
export function ringTargetOf(kind, ref) {
  if (kind !== 'label' && kind !== 'record' && kind !== 'tissue') return null;
  if (!ref || ref.pair || ref.plane) return null;
  const regionId = ref.id > 0 ? ref.id | 0 : 0, childKey = typeof ref.childKey === 'string' ? ref.childKey : '';
  return regionId || childKey ? { regionId, childKey } : null;
}
