import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// gpu-compute.js needs a DOM to import, so the two helpers are cut out of the source and evaluated here.
const src = readFileSync('docs/gpu-compute.js', 'utf8');
const grab = re => { const m = src.match(re); if (!m) throw new Error('helper not found: ' + re); return m[0]; };
const { gpuCheckBegin, gpuCheckSync, gpuSubmitChecked } = new Function(
  grab(/export function gpuCheckBegin[\s\S]*?\n}\n/).replace('export ', '') + '\n' +
  grab(/export async function gpuCheckSync[\s\S]*?\n}\n/).replace('export ', '') + '\n' +
  grab(/export async function gpuSubmitChecked[\s\S]*?\n}\n/).replace('export ', '') +
  '\nreturn{gpuCheckBegin,gpuCheckSync,gpuSubmitChecked}')();

// Fake GPUDevice with a real error-scope stack: an error raised by a command goes to the scope
// that is on top at that moment (as on a real device), or is "uncaptured" when there is none.
function fakeDevice() {
  const stack = [], log = [], uncaptured = [];
  return {
    log, uncaptured,
    pushErrorScope(f) { stack.push({ f, error: null }); log.push('push'); },
    popErrorScope() { const s = stack.pop(); log.push('pop'); return Promise.resolve(s.error); },
    fail(message) { const top = stack[stack.length - 1]; if (top) top.error ||= { message }; else uncaptured.push(message); },
    queue: { submit() { log.push('submit'); } },
  };
}

describe('gpuCheckSync', () => {
  it('runs fn between push and pop with nothing in between and returns its value', async () => {
    const d = fakeDevice();
    const p = gpuCheckSync(d, 'x', () => { d.log.push('fn'); return 42; });
    expect(d.log).toEqual(['push', 'fn', 'pop']); // all before the first await returns
    expect(await p).toBe(42);
  });
  it('throws label + message on a validation error', async () => {
    const d = fakeDevice();
    await expect(gpuCheckSync(d, 'dispatch boxMean', () => d.fail('binding 3 missing'))).rejects.toThrow('dispatch boxMean: binding 3 missing');
  });
  it('rethrows an exception of fn and still pops the scope', async () => {
    const d = fakeDevice();
    await expect(gpuCheckSync(d, 'x', () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(d.log).toEqual(['push', 'pop']);
  });
  it('concurrent calls only see their own errors', async () => {
    const d = fakeDevice();
    const bad = gpuCheckSync(d, 'bad', () => d.fail('broken'));
    const good = gpuCheckSync(d, 'good', () => 'fine');
    await expect(bad).rejects.toThrow('bad: broken');
    await expect(good).resolves.toBe('fine');
  });
  it('without error scopes it just runs fn', async () => {
    expect(await gpuCheckSync({}, 'x', () => 7)).toBe(7);
  });
  it('gpuSubmitChecked checks finish + submit together', async () => {
    const d = fakeDevice();
    await gpuSubmitChecked(d, 'extract', { finish: () => { d.fail('invalid command buffer'); return {}; } }).then(() => { throw new Error('should reject'); }, e => expect(e.message).toBe('extract: invalid command buffer'));
    await gpuSubmitChecked(d, 'ok', { finish: () => ({}) });
    expect(d.log.filter(x => x === 'submit').length).toBe(2);
  });
  it('gpuCheckBegin pushes and pops synchronously and returns the value at once', async () => {
    const d = fakeDevice();
    const r = gpuCheckBegin(d, 'x', () => { d.log.push('fn'); return 5; });
    expect(d.log).toEqual(['push', 'fn', 'pop']);
    expect(r.value).toBe(5);
    await r.done;
  });
  it('a failed gpuCheckBegin is not an unhandled rejection and gpuSubmitChecked awaits the collected checks first', async () => {
    const d = fakeDevice(), checks = [];
    checks.push(gpuCheckBegin(d, 'dispatch boxMean', () => d.fail('binding 3 missing')).done);
    checks.push(gpuCheckBegin(d, 'dispatch ok', () => 1).done);
    let finished = false;
    await expect(gpuSubmitChecked(d, 'extract', { finish: () => { finished = true; return {}; } }, checks)).rejects.toThrow('dispatch boxMean: binding 3 missing');
    expect(finished).toBe(false); // nothing is finished or submitted after a failed check
    expect(checks.length).toBe(0);
  });
});
