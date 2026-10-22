// チュートリアル data (pure constants: no DOM, no THREE; unit-tested in tests/unit/tutorial-data.test.js).
// rebuilt on the event deck's operation guide (docs/tutorial-slides.js), in the deck's order: コントローラーの使い方 (controls) → g1 グリップ → g2 断面 → g3 メニュー
// (narrowed to showing / hiding a tissue) → g3b スライスの透け具合. g4 (labels / distances) is view-only on the help board, never a step. No approach / walking task, no AR step.
// The missions are shown to the user as ステップ1..5 (each a list of pages, n/N). A page finishes when the engine (tutorial-engine.js) has received done.count signals of kind
// done.signal (emitted from the VR / page code through tutorial-signal.js); done null = the page has no signal: it is finished with 次へ (the laser + trigger on the board's button).
// Texts are i18n keys (i18n.js tut*: the Japanese words are the slide's own; English for the English UI; the VR board shows the slide picture, text = the 2D page's line of the step). sub = the slide's small line under it. hint.hand = the wording for hand
// tracking (pinch / fist, no controller buttons). item = the numbered row of the step's slide that the board frames while the step is up (the slide is shown as a picture:
// tutorial-slides.js; menu1 and menu2 are both row 1 of g3 「光線で指してトリガー」); menu = the かんたんメニュー widget the menu lights ('seg-hide' / 'seg-show' / 'slider'). audio = the voice file id (docs/tutorial/audio/F1/<audio>.m4a); audioText = its reading script (kana where TTS would misread).
// timeoutHint (ms): no signal for this long -> the UI may play the page's voice again.
// Every mission practises on sample4 (骨梁 = the 体験会 Lv0 data). Analysis is not part of the tutorial.
export const TUT_SAMPLE = 'sample4';
export const TUT_SIGNALS=Object.freeze(['grab', 'grab-move', 'scale', 'section-add', 'section-drag', 'section-scroll', 'seg-hide', 'seg-show', 'slice-opacity', 'slice-toggle', 'frame-hide']);
export const TUTORIAL_MISSIONS=deepFreeze([
 { id:'controls', sample:TUT_SAMPLE, title:'tutCtlTitle', slide:'controls',
  steps:[
   { id:'controls1', text:'tutCtlS1', audio:'controls1', audioText:'コントローラーの使い方を見て、次へを押しましょう。', done:null, next:true, timeoutHint:25000 }
  ] },
 { id:'grip', sample:TUT_SAMPLE, title:'tutGripTitle', slide:'g1',
  steps:[
   { id:'grip1', text:'tutGripS1', sub:'tutGripS1s', hint:{ hand:'tutGripS1h' }, item:1, audio:'grip1', audioText:'こうせんを向けて、グリップでつかみましょう。', done:{ signal:'grab', count:1 }, timeoutHint:20000 },
   { id:'grip2', text:'tutGripS2', sub:'tutGripS2s', hint:{ hand:'tutGripS2h' }, item:2, audio:'grip2', audioText:'にぎったまま、動かしたり、ひねったりしましょう。', done:{ signal:'grab-move', count:1 }, timeoutHint:20000 },
   { id:'grip3', text:'tutGripS3', sub:'tutGripS3s', hint:{ hand:'tutGripS3h' }, item:3, audio:'grip3', audioText:'りょうてでにぎって、広げたりせばめたりしましょう。', done:{ signal:'scale', count:1 }, timeoutHint:20000 }
  ] },
 { id:'section', sample:TUT_SAMPLE, title:'tutSecTitle', slide:'g2',
  steps:[
   { id:'section1', text:'tutSecS1', sub:'tutSecS1s', hint:{ hand:'tutSecS1h' }, item:1, audio:'section1', audioText:'ビーかワイのボタンで、だんめんを出しましょう。', done:{ signal:'section-add', count:1 }, timeoutHint:20000 },
   { id:'section2', text:'tutSecS2', sub:'tutSecS2s', hint:{ hand:'tutSecS2h' }, item:2, audio:'section2', audioText:'わくの中をトリガーでつかんで、動かしましょう。', done:{ signal:'section-drag', count:1 }, timeoutHint:20000 },
   { id:'section3', text:'tutSecS3', sub:'tutSecS3s', hint:{ hand:'tutSecS3h' }, item:3, audio:'section3', audioText:'スティックを上下にたおして、スライドしましょう。', done:{ signal:'section-scroll', count:1 }, timeoutHint:20000 }
  ] },
 { id:'menu', sample:TUT_SAMPLE, title:'tutMenuTitle', slide:'g3',
  steps:[
   { id:'menu1', text:'tutMenuS1', sub:'tutMenuS1s', hint:{ hand:'tutMenuS1h' }, item:1, menu:'seg-hide', audio:'menu1', audioText:'メニューを、こうせんで指してトリガーを押し、そしきをひひょうじにしましょう。', done:{ signal:'seg-hide', count:1 }, timeoutHint:20000 },
   { id:'menu2', text:'tutMenuS2', sub:'tutMenuS2s', hint:{ hand:'tutMenuS2h' }, item:1, menu:'seg-show', audio:'menu2', audioText:'おなじように、こうせんで指してトリガーを押し、もういちど、ひょうじにしましょう。', done:{ signal:'seg-show', count:1 }, timeoutHint:20000 }
  ] },
 { id:'slice', sample:TUT_SAMPLE, title:'tutSliceTitle', slide:'g3b',
  steps:[
   { id:'slice1', text:'tutSliceS1', sub:'tutSliceS1s', hint:{ hand:'tutSliceS1h' }, item:1, menu:'slider', audio:'slice1', audioText:'つまみをトリガーで動かしましょう。', done:{ signal:'slice-opacity', count:1 }, timeoutHint:20000 },
   { id:'slice2', text:'tutSliceS2', sub:'tutSliceS2s', hint:{ hand:'tutSliceS2h' }, item:2, audio:'slice2', audioText:'スティックを、みじかく押し込みましょう。', done:{ signal:'slice-toggle', count:1 }, timeoutHint:20000 },
   { id:'slice3', text:'tutSliceS3', sub:'tutSliceS3s', hint:{ hand:'tutSliceS3h' }, item:3, audio:'slice3', audioText:'スティックを、押し込んだままにしましょう。', done:{ signal:'frame-hide', count:1 }, timeoutHint:20000 }
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
 missionClear:Object.freeze({id:'mclear',text:'tutFbMissionClear',audio:'mclear',audioText:'ステップクリアです。'}),
 allClear:Object.freeze({id:'allclear',text:'tutFbAllClear',audio:'allclear',audioText:'すべてクリアです。おつかれさまでした。'}),
});
// the page's own introduction (tutorial-ui.js, after 「チュートリアルを始める」): first open the Lv0 practice data, then start VR / AR. Shown as a subtitle bar, spoken once each.
export const TUT_INTRO=deepFreeze({
 openLv0:{id:'intro1',text:'tutIntroLv0',audio:'intro1',audioText:'まず、レベルゼロの練習データを表示しましょう。'},
 pressVr:{id:'intro2',text:'tutIntroVr',audio:'intro2',audioText:'ブイアールで見る、のボタンを押しましょう。'},
});
