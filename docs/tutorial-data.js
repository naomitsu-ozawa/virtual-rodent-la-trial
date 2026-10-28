// チュートリアル data (pure constants: no DOM, no THREE; unit-tested in tests/unit/tutorial-data.test.js).
// rebuilt on the event deck's operation guide (docs/tutorial-slides.js), in the deck's order: コントローラーの使い方 (controls) → g1 グリップ → g2 断面 → g3 メニュー
// (narrowed to showing / hiding a tissue) → g3b スライスの透け具合. g4 (labels / distances) is view-only on the help board, never a step. No approach / walking task, no AR step.
// The missions are shown to the user as ステップ1..5 (each a list of pages, n/N). A page finishes when the engine (tutorial-engine.js) has received done.count signals of kind
// done.signal (emitted from the VR / page code through tutorial-signal.js); done null = the page has no signal: it is finished with 次へ (the laser + trigger on the board's button).
// Texts are i18n keys (i18n.js tut*; Japanese and English): text = the caption of the page (under the slide on the VR board, and the line of the 2D card). item = the numbered row of the step's slide
// that the board frames while the page is up (the slide is shown as a picture: tutorial-slides.js; menu1 and menu2 are both row 1 of g3 「光線で指してトリガー」); menu = the かんたんメニュー widget
// the menu lights ('seg-hide' / 'seg-show' / 'slider'). audio = the voice file id (docs/tutorial/audio/F1/<audio>.m4a); audioText = its reading script (kana where TTS would misread).
// timeoutHint (ms): no signal for this long -> the UI may play the page's voice again.
// every page says WHERE (the left menu's row / the section frame / the data), WHICH HAND AND BUTTON, and what finishes it. Extra fields of a step:
//   ctl = {btn, motion?}: the controller button that the 3D controller (tutorial-3d.js) blinks and points at: 'trigger' | 'grip' | 'face' (B on the right hand, Y on the left = the upper face button) | 'stick';
//         motion: 'updown' (tilt) | 'press' (a short click) | 'hold' (click and keep). Both hands show it (either hand may be used; the two-hand scale uses both).
//   board = 'menu': the page works on the left menu: the board blinks, a direction arrow shows at the edge of the view while the menu is out of view, an arrow moves over the button (tutorial-3d.js);
//   when = 'no-section': the page exists only while no section frame is up (engine cond 'no-section'); then = a second clip played right after audio (same shape as TUT_FEEDBACK then);
//   text = the caption under the slide on the board and on the 2D card (the 「{tissue}」 of a menu page = the first tissue of the open data, filled in by tutorial-vr.js).
// Every mission practises on sample4 (骨梁 = the 体験会 Lv0 data). Analysis is not part of the tutorial.
export const TUT_SAMPLE = 'sample4';
export const TUT_SIGNALS=Object.freeze(['grab', 'grab-move', 'scale', 'section-add', 'section-drag', 'section-scroll', 'seg-hide', 'seg-show', 'slice-opacity', 'slice-toggle', 'frame-hide', 'session-end']);
export const TUTORIAL_MISSIONS=deepFreeze([
 { id:'controls', sample:TUT_SAMPLE, title:'tutCtlTitle', slide:'controls',
  steps:[
   { id:'controls1', text:'tutCtlS1', audio:'ctl1', audioText:'みぎてのこうせんはオレンジ、ひだりては、みどりです。ひとさしゆびのトリガーで、こうせんのさきを押します。', ctl:{btn:'trigger'}, done:null, next:true, timeoutHint:30000 },
   { id:'controls2', text:'tutCtlS2', audio:'ctl2', audioText:'こうせんを、つぎへ、に向けて、トリガーを引いてください。', ctl:{btn:'trigger'}, done:null, next:true, timeoutHint:25000 }
  ] },
 { id:'grip', sample:TUT_SAMPLE, title:'tutGripTitle', slide:'g1',
  steps:[
   { id:'grip1', text:'tutGripS1', item:1, ctl:{btn:'grip'}, audio:'g1d', audioText:'どちらのてでも、めのまえのデータに、こうせんを向けて、なかゆびのグリップをにぎります。', done:{ signal:'grab', count:1 }, timeoutHint:25000 },
   { id:'grip2', text:'tutGripS2', item:2, ctl:{btn:'grip'}, audio:'grip2', audioText:'にぎったまま、動かしたり、ひねったりしましょう。', done:{ signal:'grab-move', count:1 }, timeoutHint:20000 },
   { id:'grip3', text:'tutGripS3', item:3, ctl:{btn:'grip'}, audio:'g1c', audioText:'りょうてでグリップをにぎり、てをひろげるとおおきく、せばめるとちいさくなります。', done:{ signal:'scale', count:1 }, timeoutHint:25000 }
  ] },
 { id:'section', sample:TUT_SAMPLE, title:'tutSecTitle', slide:'g2',
  steps:[
   { id:'section1', text:'tutSecS1', item:1, ctl:{btn:'face'}, audio:'g2a', audioText:'みぎてのビー、またはひだりてのワイを押すと、だんめんのわくが出ます。', done:{ signal:'section-add', count:1 }, timeoutHint:25000 },
   { id:'section2', text:'tutSecS2', item:2, ctl:{btn:'trigger'}, audio:'g2d', audioText:'どちらのてでも、わくの中にこうせんを向けて、トリガーを引いたまま動かします。', done:{ signal:'section-drag', count:1 }, timeoutHint:25000 },
   { id:'section3', text:'tutSecS3', item:3, ctl:{btn:'stick',motion:'updown'}, audio:'g2e', audioText:'どちらのてでも、スティックをうえ、またはしたにたおすと、だんめんがまっすぐ動きます。', done:{ signal:'section-scroll', count:1 }, timeoutHint:25000 }
  ] },
 { id:'menu', sample:TUT_SAMPLE, title:'tutMenuTitle', slide:'g3',
  steps:[
   { id:'menu1', text:'tutMenuS1', item:1, ctl:{btn:'trigger'}, menu:'seg-hide', board:'menu', audio:'g3c', audioText:'ひだりのメニューを使います。ひかっているぎょうの、ひひょうじに、こうせんを向けて、トリガーを引きます。', done:{ signal:'seg-hide', count:1 }, timeoutHint:30000 },
   { id:'menu2', text:'tutMenuS2', item:1, ctl:{btn:'trigger'}, menu:'seg-show', board:'menu', audio:'g3b', audioText:'おなじぎょうの、ひょうじを押すと、またみえます。', done:{ signal:'seg-show', count:1 }, timeoutHint:25000 }
  ] },
 { id:'slice', sample:TUT_SAMPLE, title:'tutSliceTitle', slide:'g3b',
  steps:[
   { id:'slice0', text:'tutSliceS0', ctl:{btn:'face'}, when:'no-section', audio:'g4pre', audioText:'スライスのすけぐあいは、だんめんの上にでます。ビー、またはワイで、だんめんを出してください。', done:{ signal:'section-add', count:1 }, timeoutHint:25000 },
   { id:'slice1', text:'tutSliceS1', item:1, ctl:{btn:'trigger'}, menu:'slider', board:'menu', audio:'g4d', audioText:'ひだりのメニューの、スライスのぎょうに、まるいつまみがあります。どちらのてでも、こうせんを向け、トリガーを引いたまま、さゆうに動かします。',
     then:{ id:'g4a2', audio:'g4a2', audioText:'ひだりで、すけて、みぎで、はっきりします。' }, done:{ signal:'slice-opacity', count:1 }, timeoutHint:35000 },
   { id:'slice2', text:'tutSliceS2', item:2, ctl:{btn:'stick',motion:'press'}, audio:'g4b', audioText:'どちらのてでも、スティックをみじかく押しこみます。スライスがとうめいになります。', done:{ signal:'slice-toggle', count:1 }, timeoutHint:25000 },
   { id:'slice3', text:'tutSliceS3', item:3, ctl:{btn:'stick',motion:'hold'}, audio:'g4c', audioText:'スティックを押しこんだままにすると、だんめんのわくがかくれます。', done:{ signal:'frame-hide', count:1 }, timeoutHint:25000 }
  ] },
 // the data switch inside VR / AR (the pages explain it; both finish with 次へ). If the visitor really switches here (the data leaves the tutorial's Lv0),: this ステップ is done and 'exit' starts at once (engine.dataSwitched), going back is shut. Its voice files (dat1 / dat2) are in
 // docs/tutorial/audio/F1 and M1 (tutorial-audio.js skips a missing file, so a page without one is silent and only the captions carry it).
 { id:'data', sample:TUT_SAMPLE, title:'tutDataTitle', slide:'g3',
  steps:[
   { id:'data1', text:'tutDataS1', ctl:{btn:'trigger'}, board:'menu', menu:'levels', audio:'dat1', audioText:'ひだりのメニューの、したのデータのぎょうに、レベルゼロからレベルさんの、ボタンがあります。ブイアールのまま、べつのデータに切りかえられます。', done:null, next:true, timeoutHint:30000 },
   { id:'data2', text:'tutDataS2', ctl:{btn:'trigger'}, board:'menu', menu:'levels', audio:'dat2', audioText:'ボタンにこうせんを向けて、トリガーを引くと、もういちど、と出ます。もういちど引くと、切りかわります。だんめんやポイントは、消えます。', done:null, next:true, timeoutHint:30000 }
  ] },
 // the way out. The menu's red 「VRを終了」 / 「ARを終了」 button (bottom right of the left menu; its row is row 3 of the g3 slide: 下のボタン): the page is done when the session ends
 // (signal 'session-end', sent by vr-view.js as the session closes); the page (tutorial-ui.js) then guides to Lv1-Lv3 on the browser screen.
 // this page is FREE (free:true): no controller ring / arrow (no ctl), no slide row frame (no item), no edge arrow towards the menu, and the tutorial no longer ends when the data is switched here;
 // the only light is the arrow over the red button (menu:'exit'). The visitor may do anything; the page still ends with the session and going back stays shut after a data switch (backLocked). Voice ex2 is not made yet (ex1 said the old line).
 { id:'exit', sample:TUT_SAMPLE, title:'tutExitTitle', slide:'g3',
  steps:[
   { id:'exit1', text:'tutExitS1', menu:'exit', board:'menu', free:true, audio:'ex2', audioText:'このボタンで、しゅうりょうできます。このあんないで、チュートリアルはしゅうりょうです。こころゆくまで、おたのしみください。', done:{ signal:'session-end', count:1 }, timeoutHint:35000 }
  ] }
]);
function deepFreeze(o){if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.freeze(o);for(const v of Object.values(o))deepFreeze(v)}return o}
// {tissue} of a caption = the first tissue of the open data (its real name); without one the fallback words (tutTissueFallback)
export const fillTissue=(text,name,fallback)=>String(text||'').replace('{tissue}',name||fallback||'');
export const missionById=id=>TUTORIAL_MISSIONS.find(m=>m.id===id)||null;
export const TUT_VOICES=Object.freeze(['F1','M1']);
// the line each voice says when the ray / pointer comes onto its button in the voice choice dialog (tutorial-ui.js). Kanji on purpose: the kana spelling gave 案内 a rising
// accent; both voices' 案内 is slowed to 0.70 by hand (tools/tts/pick_f.py; M1: tools/tts/SETUP.md), so regenerating from this text alone would not give the shipped files.
export const TUT_VOICE_PICK=deepFreeze({id:'pick',text:'tutVoicePick',audio:'pick',audioText:'私が案内します。'});
// Spoken feedback (calm, short). The engine names which to play (snapshot.feedback = 'stepClear' | 'missionClear' | 'allClear'; stepClear rotates through the list).
// a cleared ステップ waits for 次へ. missionClear / allClear carry `then` = the line spoken right after it (snapshot.feedbackItem.then): goNext = go on with 次へ, end = the tutorial is over
// (tutorial-audio.js speechFor plays both; the board / panel show the then text as well). goNext is a top-level entry of TUT_FEEDBACK (tools/gen-tutorial-audio.mjs makes its voice).
// the last ステップ (exit) ends with the session itself, so allClear has no closing line of its own: the page then guides to Lv1-Lv3 (TUT_INTRO.chooseLv).
const GO_NEXT=Object.freeze({id:'gonext',text:'tutFbGoNext',audio:'gonext',audioText:'つぎのステップに進みましょう。つぎへ、を押してください。'});
export const TUT_FEEDBACK=Object.freeze({
 stepClear:Object.freeze([
  Object.freeze({id:'ok1',text:'tutFbOk1',audio:'ok1',audioText:'できました。'}),
  Object.freeze({id:'ok2',text:'tutFbOk2',audio:'ok2',audioText:'いいですね。'}),
  Object.freeze({id:'ok3',text:'tutFbOk3',audio:'ok3',audioText:'その調子です。'}),
 ]),
 missionClear:Object.freeze({id:'mclear',text:'tutFbMissionClear',audio:'mclear',audioText:'ステップクリアです。',then:GO_NEXT}),
 allClear:Object.freeze({id:'allclear',text:'tutFbAllClear',audio:'allclear',audioText:'すべてクリアです。おつかれさまでした。'}),
 goNext:GO_NEXT,
});
// right after a VR / AR session starts, before ステップ1: look right (the 操作パネル = the help board), then look left (the メニュー). Each line is spoken; its board blinks;
// turning the head toward the board (tutorial-orient.js) or 次へ goes on. Right = the help board (vr-layout.js HELP_OFFSET, 50 deg right), left = the menu (MENU_OFFSET, 50 deg left).
export const TUT_ORIENT=deepFreeze({
 right:{id:'orient1',text:'tutOrientRight',audio:'orient1',audioText:'みぎを見てください。これが、そうさパネルです。やることが、ここに表示されます。',board:'help'},
 left:{id:'orient2',text:'tutOrientLeft',audio:'orient2',audioText:'ひだりを見てください。これが、メニューです。',board:'menu'},
});
// the menu is closed while a page works on it: the caption / voice say how to open it (A or X, long press: vr-view.js onAxLong) and the 3D controller points at the lower face button (A / X) held
export const TUT_MENU_OPEN=deepFreeze({id:'g3open',text:'tutMenuClosed',audio:'g3open',audioText:'メニューがとじています。エーまたはエックスのボタンを、ながおしすると、ひらきます。',ctl:{btn:'facelow',motion:'hold'}});
// pressVr = 「VRで見る」か「ARで見る」 (the AR button is there: both are lit), pressVrOnly = only 「VRで見る」 (no AR on this device); chooseLv = after the tutorial: pick Lv1-Lv3 on the page.
// the page's own introduction (tutorial-ui.js, after 「チュートリアルを始める」): first open the Lv0 practice data, then start VR / AR. Shown as a subtitle bar, spoken once each.
export const TUT_INTRO=deepFreeze({
 openLv0:{id:'intro1',text:'tutIntroLv0',audio:'intro1',audioText:'まず、レベルゼロの練習データを表示しましょう。'},
 pressVr:{id:'intro4',text:'tutIntroVr',audio:'intro4',audioText:'ブイアールで見る、または、エーアールで見る、のボタンを押しましょう。'},
 pressVrOnly:{id:'intro2',text:'tutIntroVrOnly',audio:'intro2',audioText:'ブイアールで見る、のボタンを押しましょう。'},
 chooseLv:{id:'intro5',text:'tutIntroLv123',audio:'intro5',audioText:'つぎは、レベルいちからレベルさんの中から、ひとつ、えらびましょう。'},
 startVr:{id:'intro3',text:'tutIntroStart',audio:'intro3',audioText:'がめんの、かいしボタンを押してください。'},
});
