// チュートリアル data (pure constants: no DOM, no THREE; unit-tested in tests/unit/tutorial-data.test.js).
// Eight missions, each a list of steps. A step finishes when the engine (tutorial-engine.js) has received done.count signals of kind done.signal
// (emitted from the VR / page code through tutorial-signal.js). Texts are i18n keys (i18n.js tut*: Japanese body + English subtitle). hint.ctrl / hint.hand
// are optional device-specific wordings of the same step (hands: pinch = つまむ, laser modes 標準 / 指差し; no diagrams). audio is the id of a pre-generated
// voice file (docs/tutorial/audio/<audio>.m4a, added later); audioText is its Japanese reading script (kana where TTS would misread: VR -> ブイアール).
// timeoutHint (ms): no signal for this long -> the UI may play the step's voice again.
// Mission flags: requiresAr (M7: skipped on devices without AR), requiresAnalysis + optional (M8: only datasets with analysis labels; never blocks anything).
export const TUT_SIGNALS=Object.freeze(['vr-start', 'move', 'scale', 'home', 'menu-open', 'seg-toggle', 'menu-close', 'section-add', 'section-drag', 'section-toggle', 'slice-clear', 'frame-hide', 'point-record', 'undo', 'measure-done', 'ar-start', 'session-end', 'trigger-label', 'label-show']);
export const TUTORIAL_MISSIONS=deepFreeze([
 { id:'m1', sample:'sample4', title:'tutM1Title',
  steps:[
   { id:'m1s2', text:'tutM1S2', audio:'m1s2', audioText:'からだを動かして、ボリュームに近づきましょう。', done:{ signal:'move', count:1 }, timeoutHint:20000 },
   { id:'m1s3', text:'tutM1S3', audio:'m1s3', audioText:'りょうてで、おおきさを変えましょう。', done:{ signal:'scale', count:1 }, hint:{ ctrl:'tutM1S3c', hand:'tutM1S3h' }, timeoutHint:20000 },
   { id:'m1s4', text:'tutM1S4', audio:'m1s4', audioText:'ボリュームを、正面に戻しましょう。', done:{ signal:'home', count:1 }, timeoutHint:20000 }
  ] },
 { id:'m2', sample:'sample4', title:'tutM2Title',
  steps:[
   { id:'m2s1', text:'tutM2S1', audio:'m2s1', audioText:'メニューを開きましょう。', done:{ signal:'menu-open', count:1 }, hint:{ ctrl:'tutM2S1c', hand:'tutM2S1h' }, timeoutHint:20000 },
   { id:'m2s2', text:'tutM2S2', audio:'m2s2', audioText:'「ひょうじ」と「ひひょうじ」を、切り替えましょう。', done:{ signal:'seg-toggle', count:1 }, timeoutHint:20000 },
   { id:'m2s3', text:'tutM2S3', audio:'m2s3', audioText:'メニューを閉じましょう。', done:{ signal:'menu-close', count:1 }, timeoutHint:20000 }
  ] },
 { id:'m3', sample:'sample4', title:'tutM3Title',
  steps:[
   { id:'m3s1', text:'tutM3S1', audio:'m3s1', audioText:'だんめんを、出しましょう。', done:{ signal:'section-add', count:1 }, hint:{ ctrl:'tutM3S1c', hand:'tutM3S1h' }, timeoutHint:20000 },
   { id:'m3s2', text:'tutM3S2', audio:'m3s2', audioText:'だんめんを、つかんで動かしましょう。', done:{ signal:'section-drag', count:1 }, hint:{ ctrl:'tutM3S2c', hand:'tutM3S2h' }, timeoutHint:20000 },
   { id:'m3s3', text:'tutM3S3', audio:'m3s3', audioText:'だんめんを、消したり、出したりしましょう。', done:{ signal:'section-toggle', count:1 }, timeoutHint:20000 }
  ] },
 { id:'m4', sample:'sample3', title:'tutM4Title',
  steps:[
   { id:'m4s1', text:'tutM4S1', audio:'m4s1', audioText:'だんめんを、はんとうめいにしましょう。', done:{ signal:'slice-clear', count:1 }, hint:{ ctrl:'tutM4S1c', hand:'tutM4S1h' }, timeoutHint:20000 },
   { id:'m4s2', text:'tutM4S2', audio:'m4s2', audioText:'わくを、隠しましょう。', done:{ signal:'frame-hide', count:1 }, hint:{ ctrl:'tutM4S2c', hand:'tutM4S2h' }, timeoutHint:20000 }
  ] },
 { id:'m5', sample:'sample3', title:'tutM5Title',
  steps:[
   { id:'m5s1', text:'tutM5S1', audio:'m5s1', audioText:'そしきに、しるしをつけましょう。', done:{ signal:'point-record', count:1 }, hint:{ ctrl:'tutM5S1c', hand:'tutM5S1h' }, timeoutHint:20000 },
   { id:'m5s2', text:'tutM5S2', audio:'m5s2', audioText:'しるしを、取り消しましょう。', done:{ signal:'undo', count:1 }, timeoutHint:20000 }
  ] },
 { id:'m6', sample:'sample1', title:'tutM6Title',
  steps:[
   { id:'m6s1', text:'tutM6S1', audio:'m6s1', audioText:'2かしょに、しるしをつけましょう。', done:{ signal:'point-record', count:2 }, timeoutHint:20000 },
   { id:'m6s2', text:'tutM6S2', audio:'m6s2', audioText:'しるしを長押しして、きょりを見ましょう。', done:{ signal:'measure-done', count:1 }, timeoutHint:20000 }
  ] },
 { id:'m7', sample:'sample4', title:'tutM7Title', requiresAr:true,
  steps:[
   { id:'m7s1', text:'tutM7S1', audio:'m7s1', audioText:'エーアールボタンを押して、エーアールで見ましょう。', done:{ signal:'ar-start', count:1 }, timeoutHint:20000 },
   { id:'m7s2', text:'tutM7S2', audio:'m7s2', audioText:'置いて、おおきさを変えましょう。', done:{ signal:'scale', count:1 }, timeoutHint:20000 },
   { id:'m7s3', text:'tutM7S3', audio:'m7s3', audioText:'エーアールを終了しましょう。', done:{ signal:'session-end', count:1 }, timeoutHint:20000 }
  ] },
 { id:'m8', sample:'sample2', title:'tutM8Title', optional:true, requiresAnalysis:true,
  steps:[
   { id:'m8s1', text:'tutM8S1', audio:'m8s1', audioText:'メニューで、かいせきモードに切り替えましょう。', done:{ signal:'trigger-label', count:1 }, timeoutHint:20000 },
   { id:'m8s2', text:'tutM8S2', audio:'m8s2', audioText:'りょういきを指して、名前を見ましょう。', done:{ signal:'label-show', count:1 }, hint:{ ctrl:'tutM8S2c', hand:'tutM8S2h' }, timeoutHint:20000 }
  ] }
]);
function deepFreeze(o){if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.freeze(o);for(const v of Object.values(o))deepFreeze(v)}return o}
export const missionById=id=>TUTORIAL_MISSIONS.find(m=>m.id===id)||null;
export const TUT_VOICES=Object.freeze(['F1']);
// Spoken feedback (calm, short). The engine names which to play (snapshot.feedback = 'stepClear' | 'missionClear' | 'allClear'; stepClear rotates through the list).
export const TUT_FEEDBACK=Object.freeze({
 stepClear:Object.freeze([
  Object.freeze({id:'ok1',text:'tutFbOk1',audio:'ok1',audioText:'できました。'}),
  Object.freeze({id:'ok2',text:'tutFbOk2',audio:'ok2',audioText:'いいですね。'}),
  Object.freeze({id:'ok3',text:'tutFbOk3',audio:'ok3',audioText:'その調子です。'}),
 ]),
 missionClear:Object.freeze({id:'mclear',text:'tutFbMissionClear',audio:'mclear',audioText:'ミッションクリアです。'}),
 allClear:Object.freeze({id:'allclear',text:'tutFbAllClear',audio:'allclear',audioText:'すべてクリアです。おつかれさまでした。'}),
});
