// A delayed "end" of an interaction. The end of a 3D drag used to restore the full resolution at once, so the heavy frame
// (1.0 MP) was drawn the moment the pointer was lifted; a drag that starts again right after (a second stroke, a pinch
// that lost a finger) then paid for it twice. end(delay) waits; begin() / cancel() drops a pending end, so a drag that
// resumes within the delay simply stays at the low resolution. end(0) runs at once (the wheel already has its own delay).
export function makeDeferredEnd(run, schedule = setTimeout, unschedule = clearTimeout) {
  let timer = null;
  const cancel = () => { if (timer !== null) { unschedule(timer); timer = null; } };
  return {
    cancel,
    pending: () => timer !== null,
    end(delay = 0) {
      cancel();
      if (!(delay > 0)) { run(); return; }
      timer = schedule(() => { timer = null; run(); }, delay);
    },
  };
}
