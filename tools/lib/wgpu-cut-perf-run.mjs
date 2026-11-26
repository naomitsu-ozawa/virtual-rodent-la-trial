// The node side of M6_PERF=1 (tools/wgpu-m6-check.mjs, page code in tools/lib/wgpu-cut-perf.js): the scenarios are run round-robin, several rounds, and each is given CPU TIME (user + system ticks of Chromium's process tree: SwiftShader is a
// CPU renderer, and the wall clock of a draw swings with the other jobs on the machine, as tools/vr-frame-time.mjs found) next to the GPU timestamps and the counts. The figures are relative (a proxy for the device, not the device):
// the counts (passes, the bytes of the attachments a pass loads and stores) are exact, the milliseconds are SwiftShader's.
import fs from 'node:fs';
function treeTicks() {
  const kids = new Map(), cpu = new Map();
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try { const st = fs.readFileSync('/proc/' + d + '/stat', 'utf8'), f = st.slice(st.lastIndexOf(')') + 2).split(' '); (kids.get(+f[1]) || kids.set(+f[1], []).get(+f[1])).push(+d); cpu.set(+d, +f[11] + +f[12]); } catch { /* process gone */ }
  }
  let t = 0; const walk = p => { for (const k of kids.get(p) || []) { t += cpu.get(k) || 0; walk(k); } }; walk(process.pid);
  return t * 10;
}
const med = a => { const v = a.filter(x => x !== null && Number.isFinite(x)).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : null; };
export async function driveCutPerf(pg, { rounds = 3, n = 2, hitch = true } = {}) {
  const keys = await pg.evaluate(() => window.__perf.keys), res = Object.fromEntries(keys.map(k => [k, { cpu: [], gpu: [], last: null }]));
  for (let r = 0; r < rounds; r++) {
    const order = r % 2 ? [...keys].reverse() : keys;
    for (const k of order) {
      await pg.evaluate(k => window.__perf.run(k, 1), k); // (warm: programs, tiles, marks)
      const t0 = treeTicks(), x = await pg.evaluate(({ k, n }) => window.__perf.run(k, n), { k, n }), t1 = treeTicks();
      res[k].cpu.push((t1 - t0) / n); res[k].gpu.push(x.gpuMs); res[k].last = x;
    }
  }
  const out = { rows: keys.map(k => ({ key: k, cpuMs: med(res[k].cpu), gpuMs: med(res[k].gpu), ...res[k].last })) };
  for (const g of [...new Set(keys.map(k => k.split(' | ')[0]))]) {
    const base = out.rows.find(r => r.key === g + ' | body');
    for (const r of out.rows) if (r.key.startsWith(g + ' | ')) { r.cpuRatio = +(r.cpuMs / base.cpuMs).toFixed(2); r.gpuRatio = r.gpuMs && base.gpuMs ? +(r.gpuMs / base.gpuMs).toFixed(2) : null; }
  }
  if (hitch) out.hitch = await pg.evaluate(() => window.__perf.hitch());
  return out;
}
export function printCutPerf(out) {
  for (const r of out.rows) console.log(r.key.padEnd(52) + ' cpu ' + String(Math.round(r.cpuMs)).padStart(6) + ' ms (x' + r.cpuRatio + ') · gpu ts ' + (r.gpuMs === null ? '-' : r.gpuMs.toFixed(1)) + ' ms (x' + r.gpuRatio + ') · submits ' + r.submits + ' render ' + r.renderPasses + ' compute ' + r.computePasses + ' draws ' + r.draws + ' workgroups ' + r.workgroups + ' · attachments loaded ' + r.loadMB + ' MB, stored ' + r.storeMB + ' MB');
  if (out.hitch) {
    console.log('-- a walk through the states of a session: per frame what was made (tex = textures with their MB, bg = bind groups, buf = buffers, pipe = pipelines, mod = shader modules) and draw()\'s JS ms');
    for (const s of out.hitch) console.log(s.label.padEnd(40) + String(s.i).padStart(2) + ' js ' + String(s.jsMs).padStart(6) + ' ms · tex ' + s.tex + ' (' + s.texMB + ' MB) bg ' + s.bg + ' buf ' + s.buf + ' pipe ' + s.pipe + ' mod ' + s.mod + ' · render ' + s.rp + ' compute ' + s.cp + ' · loaded ' + s.load + ' MB stored ' + s.store + ' MB · texture writes ' + s.wr + ' (' + s.wrMB + ' MB)');
  }
}
