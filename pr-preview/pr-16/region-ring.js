import { regionVisible, regionHidden } from './region-visibility.js?v=20261112-build728';

// the ids of the items (the same in the one-target and the two-target ring, so one confirm handles both)
export const RING_ITEM_IDS = Object.freeze(['rcolor', 'rshape', 'ccolor', 'cshape', 'rdetach', 'cdetach', 'pback']);

export function ringState(reg, child, seen = null) {
  return {
    reg: reg ? { color: seen && typeof seen.reg === 'boolean' ? seen.reg : regionVisible(reg), shape: !regionHidden(reg) } : null,
    child: child ? { color: seen && typeof seen.child === 'boolean' ? seen.child : child.colorOff !== true, shape: child.visible !== false } : null,
  };
}

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
