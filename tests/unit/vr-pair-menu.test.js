import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { simpleMenuLayout, SIMPLE_MENU, SIMPLE_MENU as M } from '../../docs/event-mode.js';
import { I18N } from '../../docs/i18n.js';
import { sampleJsonUrl, setKnownSampleIds, setKnownSamplePairs } from '../../docs/sample-sets.js';

const src = readFileSync(new URL('../../docs/vr-view.js', import.meta.url), 'utf8');
const text = { show: 'S', hide: 'H', section: 'sec', sliceOpacity: 'op', trigger: 't', trigPoint: 'p', trigLabel: 'l', trigHintPoint: 'hp', trigHintLabel: 'hl', results: 'r', total: 't', page: 'p', noSeg: 'n', home: 'h', undo: 'u', reset: 'r', resetAgain: 'ra', all: 'a', exit: 'e', kids: 'k' };
const base = { segments: [{ key: 'bone', name: 'bone', on: true }], results: [], text };
const find = (w, id) => w.find(x => x.id === id);

describe('the pair row of the かんたん menu (stage 3)', () => {
  it('without o.pair the board has no pair widget (the board of before)', () => {
    expect(find(simpleMenuLayout(base), 'pair:toggle')).toBeUndefined();
  });
  it('one wide button 「pair:toggle」 where the level row sits; lit while the partner is beside; disabled while it loads', () => {
    const b = find(simpleMenuLayout({ ...base, pair: { label: 'with X', on: false, busy: false } }), 'pair:toggle');
    expect(b).toMatchObject({ type: 'button', label: 'with X', on: false, x: M.X, y: M.LEVEL_Y, w: M.W - 2 * M.X, h: M.BTN_H }); expect(b.disabled).toBe(false);
    expect(find(simpleMenuLayout({ ...base, pair: { label: 's', on: true, busy: true } }), 'pair:toggle')).toMatchObject({ on: true, disabled: true });
  });
  it('with the level row too it sits above that one, and the results list gives it the room; the bottom row stays', () => {
    const lv = { items: [{ id: 'lv1', label: 'Lv1', on: true, armed: false }], busy: false, hint: '', text: { title: 'D', again: 'A' } };
    const w = simpleMenuLayout({ ...base, levels: lv, pair: { label: 'x', on: false } });
    const p = find(w, 'pair:toggle'), l = find(w, 'level:lv1'), e = find(w, 'exit');
    expect(p.y + p.h).toBeLessThan(l.y); expect(l.y).toBe(M.LEVEL_Y); expect(e.y).toBe(M.BOTTOM);
    const res = Array.from({ length: 30 }, (_, i) => ({ hex: '#fff', name: 'r' + i, text: 'v' }));
    const rows = simpleMenuLayout({ ...base, results: res, total: '1', levels: lv, pair: { label: 'x', on: false } }).filter(x => /^result:\d+$/.test(x.id));
    for (const r of rows) expect(r.y + r.h).toBeLessThanOrEqual(p.y);
  });
});

describe('the texts and the partner name URL', () => {
  it('two new texts in both languages, nothing else added', () => {
    expect(I18N.ja.evPairWith).toBe('{name}と並べる'); expect(I18N.ja.evPairStop).toBe('並べるのをやめる');
    expect(I18N.en.evPairWith).toContain('{name}'); expect(I18N.en.evPairStop).toBeTruthy();
  });
  it('the partner\'s sample.json is built only for a listed partner below a valid dataset folder', () => {
    setKnownSampleIds(['sample7']); setKnownSamplePairs({ sample7: [{ dir: 'arthritis', project: 'p.vrlab' }] });
    expect(sampleJsonUrl('sample7/arthritis')).toBe('demo/sample7/arthritis/sample.json');
    for (const bad of ['sample7/other', 'sample8/arthritis', '../x/arthritis', 'sample7/../x', 'sample7/arthritis/x']) expect(() => sampleJsonUrl(bad)).toThrow();
    expect(sampleJsonUrl('sample7')).toBe('demo/sample7/sample.json');
  });
});

describe('vr-view.js wiring of stage 3 (static)', () => {
  it('the row is judged from the open data (__vrlOpenSample) and sample-pairs.json, in both menus; a press starts / stops; the board is the data switch\'s', () => {
    expect(src).toContain("const pairRowOn=()=>!!pairInfo.id&&pairInfo.id===globalThis.__vrlOpenSample&&!!P&&!!mesh&&!ui.swapFailed;");
    expect(src).toContain("acts={'pair:toggle':()=>{void pairToggle()}");
    expect(src).toContain("pair:pairRowOn()?{label:pairRowText(),on:pairShownNow(),busy:!!pairLoading||ui.swapBusy}:null");
    expect(src).toContain("if(pairRowOn())btn(X,pairY,MENU_W-2*X,pairRowText(),pairShownNow()");
    const t = src.slice(src.indexOf('const pairToggle=async()=>{'), src.indexOf(' let flingDbg'));
    expect(t).toContain('loadInfo=info;loadBoard.refresh();placeLoadNow()'); expect(t).toContain('startPair(id,dir,{onStage:stage'); expect(t).toContain('flashMsg(L.failed+'); expect(t).toContain('pairBoardEnd(info)');
    expect(t).not.toContain('loadInfo.error'); // the board's retry line (「データ」から選び直す) is not for this
    expect(src).toContain('ui.status=L.stNone;menu.refresh();void refreshPairInfo();'); // after a switch the new data's partner
  });
  it('the partner\'s points / distances are their own store, dropped with it; nothing of them is put in the project\'s lists', () => {
    expect(src).toContain('store:createPairStore()'); expect(src).toContain('pt.store.clear()'); expect(src).toContain('undo.dropWhere(');
    const rp = src.slice(src.indexOf('const recordPoint=(c,hit)=>{'), src.indexOf('const selectPoint'));
    expect(rp).toContain('...(X?{store:X.store}:{})');
    expect(src).toContain('c.userData.volHit=vh;c.userData.secHit=sh;c.userData.pairHit=vp2;'); // the HU line / grips keep reading the primary's hits
    expect(src).toContain('const vx=vp2&&(!vh||vp2.distance<vh.distance)?vp2:vh,sx=sp2&&(!sh||sp2.distance<sh.distance)?sp2:sh;');
    expect(src).toContain('pulse(c,0.15,30);flashMsg(L.ptDistOtherPair,3000);return}'); // a distance is between two points of one volume (never between the two datasets of a pair: its own refusal text, a weak pulse)
    expect(src).toContain('msCancel();pstore()?.clear();'); // 最初の状態に戻す
  });
  it('review items: only the page\'s own preparation writes the cache state; the partner is prepared at 256; a stop is not a failure; its uploads go with it', () => {
    const f = src.slice(src.indexOf('async function prepareVrDataFrom('), src.indexOf('\n}\n', src.indexOf('async function prepareVrDataFrom(')));
    expect(f.match(/vrCacheState\.last=cinfo/g)).toHaveLength(2); expect(f.match(/if\(track\)vrCacheState\.last=cinfo/g)).toHaveLength(2); expect(f).toContain('if(track)vrCacheNotify?.()');
    expect(f.match(/maxTexture3D\(\)/g)).toHaveLength(1); // the default of maxDim, in the signature only
    expect(src).not.toContain('saved=vrCacheState.last'); expect(src).toContain('maxDim:256,dropped:');
    expect(src).toContain("const pairCancelled=e=>/(^|\\s)cancelled$/.test(String(e?.message))");
    expect(src).toContain("unbind:job=>{if(job)uploadQueue.drop(k=>k.startsWith('pair'+job.gen+'-'))");
    expect(src).toContain(".includes(false)){if(!live())throw new Error('cancelled');throw new Error('the partner upload did not finish')}");
    expect(src).toContain('lit=anyLit(at,highlightChildRid?childHlAt():-1)');
    expect(src).toContain('holder.position.x-=holder.scale.x*pair.delta[0]/2');
    expect(src).toContain('pt.nearer=head.distanceTo(pairOrd)<dp'); expect(src).toContain('pt.mesh.renderOrder=low?(pt.nearer?0.5:1.5):(pt.nearer?1.5:0.5);');
  });
});

describe('round 2: name cards on both sides, no distance between the datasets, the point list of a pair (static)', () => {
  it('the tap on a bone of the partner goes to the partner\'s own rule (px.toggle), togglePin keeps the primary\'s; a tap on a partner card (id \'pp<n>\') takes both sides away; pickPin also picks the partner\'s cards', () => {
    expect(src).toContain("else if(k==='label'){if(pr.hit0?.pair)px.toggle(c,pr.hit0);else togglePin(c,pr.hit0)}");
    expect(src).toContain("if(ld0?.pin&&pr.res.kind==='mlabel'&&typeof ld0.id==='string'){if(rel==='tap'&&!ld0.moved&&!ld0.done)px.unpin(c,ld0.id);return}");
    expect(src).toContain('for(const lb of px.cards().values()){'); expect(src).toContain('toggle:pairToggle,unpin:pairUnpin,cards:()=>pair?pair.pins:NO_CARDS');
    const t = src.slice(src.indexOf('const togglePin='), src.indexOf('const hovR=')); expect(t).not.toContain('pair'); // togglePin is untouched: it reads the primary only
  });
  it('pairPins: a card is there while the primary\'s of the same bone is pinned (or the partner has one of its own, for the session); its place: the tapped one > its .vrlab one > the surface seen from the head, worked out once', () => {
    const t = src.slice(src.indexOf('const surfaceAnchorOf='), src.indexOf('Object.assign(px,{hit:pairHit'));
    expect(t).toContain('const s=pt.sess.get(reg.id);'); expect(t).toContain('if(s)return s.off?null:s.lab;'); expect(t).toContain('if(reg.label)return reg.label;'); expect(t).toContain('pt.sess.set(reg.id,{lab})');
    expect(t).toContain('surfaceAnchor({contains:(i,j,k)=>analysisRunsContain(reg.runsBySlice,i,j,k),eye,target:inside})'); expect(t).toContain('resultRepresentativeVoxel(reg)');
    expect(t).toContain('if(p&&!p.label)pt.sess.delete(reg.id);');
    expect(t).toContain('setRegionLabel(p,{anchor:a});pt.sess.set(reg.id,'); // a tap on the partner's bone with a primary result of the same bone: the primary's label goes into the project like the primary's own tap
    expect(src).toContain('pt.sess.clear()'); // the session-only cards go with the partner
  });
  it('measure: the refusal has its own text and a weak pulse, the hint names the dataset, a point of the other dataset is not lit while a distance is made, the list and the selection know both datasets', () => {
    expect(src).toContain('const measureOtherData=id=>');
    expect(src).toContain('const hovPt=res.kind===\'point\'&&!measureOtherData(res.ref.id)?res.ref.id:null;if(hovPt)hoverIds.add(hovPt);'); expect(src).toContain('hpz.update(hovPt,nowF)');
    expect(src).toContain("else if(r.kind==='other-series')flashMsg(L.ptDistOther,3000);"); // the series case keeps its text
    const mv = readFileSync(new URL('../../docs/vr-measure.js', import.meta.url), 'utf8'); // the hint of a pair is long: only the hint shrinks to its label, every other label is drawn as before
    expect(mv).toContain("drawText(start.hint,hint,'bold 30px system-ui,sans-serif',false,true);"); expect(mv).toContain('const drawText=(lb,text,font,lit=false,fit=false)=>{'); expect(mv).toContain('...(fit?[c.width-36]:[])');
    expect(src).toContain('const selNo=vpSel?ptIndex(vpSel)+1:0;');
    const t = src.slice(src.indexOf('const ptRow='), src.indexOf('}else if(ui.tab===7){'));
    expect(t).toContain('if(pair?.on){'); expect(t).toContain('list.slice(-3)'); expect(t).toContain('block(false,mine);block(true,pair.store.getComments()'); expect(t).toContain('const shown=mine.slice(-5);');
    expect(src).toContain("ptDistHint:'終点のポイントを選んでください'"); // the plain hint is unchanged
  });
});
