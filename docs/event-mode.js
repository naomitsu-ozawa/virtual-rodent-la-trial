// build 626: 体験会モード (hands-on event mode). Pure: no DOM, no THREE, unit-tested (tests/unit/event-mode.test.js).
// Four levels, each one of the bundled practice datasets (docs/demo/sampleN, the same set ids as the practice-data chooser);
// texts are i18n keys (i18n.js). The switch is settings.eventMode (app-settings.js, per device, default off); the chosen
// level lives only in this page (a reload starts with none chosen) and follows whichever practice dataset was opened last.
export const EVENT_HINT_KEYS={section:'evHintSection',move:'evHintMove',toggle:'evHintToggle',mark:'evHintMark',distance:'evHintDistance'};
export const EVENT_LEVELS=Object.freeze([
 {id:'lv0',lv:0,sample:'sample4',nameKey:'evLv0Name',missionKey:'evLv0Mission',hints:['section','move']},
 {id:'lv1',lv:1,sample:'sample3',nameKey:'evLv1Name',missionKey:'evLv1Mission',hints:['section','move','toggle']},
 {id:'lv2',lv:2,sample:'sample2',nameKey:'evLv2Name',missionKey:'evLv2Mission',hints:['section','move','toggle']},
 {id:'lv3',lv:3,sample:'sample1',nameKey:'evLv3Name',missionKey:'evLv3Mission',hints:['section','move','mark','distance']},
].map(l=>Object.freeze({...l,hints:Object.freeze(l.hints)})));
export const levelById=id=>EVENT_LEVELS.find(l=>l.id===id)||null;
export const levelForSample=sample=>EVENT_LEVELS.find(l=>l.sample===sample)||null;
let chosen=null;
// id of a level, or null / unknown = none chosen
export function chooseEventLevel(id){chosen=levelById(id)?.id??null;return chosen}
export const chosenEventLevel=()=>levelById(chosen);
// the switch, read through the settings api (globalThis.__vrlSettings by default); any failure reads as off
export function eventModeOn(api=globalThis.__vrlSettings){try{return api?.get?.('eventMode')===true}catch{return false}}
// the level whose mission is shown (VR help board): null when the mode is off or no level was chosen
export const activeEventLevel=api=>eventModeOn(api)?chosenEventLevel():null;
// The VR かんたん menu is GENERIC: the same for every level, for every dataset and with no level chosen (the level only picks the mission shown on
// the help board). Its contents come from the loaded dataset: one 表示 / 非表示 row per shown segment (active and enabled; at most MAX_SEG_ROWS, the
// rest is counted), 断面, the trigger switch (only when the dataset has analysis results), the analysis results as a read-only list, and the bottom row.
export const MAX_SEG_ROWS=6;
// the segment rows: the shown segments (active and enabled, in the order given), capped
export const simpleMenuSegments=shownKeys=>[...(shownKeys||[])].slice(0,MAX_SEG_ROWS);
// What the trigger does is ONE of two exclusive modes, switched on the board (never both):
//  'point' = a short press records a point (印) where the laser meets the surface / the section (vr-view.js, vrPointMode decides where);
//  'label' = the laser on an analysed region shows its label and the trigger pins / unpins it (as in the 解析 tab).
// The switch exists only when the dataset has analysis results (a label needs a result); without them the trigger is always 'point'.
// The start is always 'point', for every dataset: it is the one every mission can use (Lv3 marks and measures) and it never swallows a press;
// a visitor who wants the labels presses 解析モード once, and the board says what the trigger does now.
export const triggerModeRow=hasResults=>!!hasResults;
export const TRIGGER_AT_START='point';
export const triggerMode=(labelsOn,hasResults)=>hasResults&&labelsOn?'label':'point';
// the かんたん menu's board layout (1024 x 1180 px canvas), pure so that it can be tested and drawn without a headset. Widgets only carry an id;
// vr-view.js maps the id to its action: 'seg:<key>:show|hide', 'section:show|hide', 'trigger:point|label', 'undo', 'home', 'all', 'exit'.
// Advanced settings (quality, foveation, HU window, ...) are not here: すべての設定 opens the full menu.
export const SIMPLE_MENU=Object.freeze({W:1024,H:1180,X:40,STATUS:140,TOP:190,ROW:92,TRIG_ROW:108,BTN_H:72,LIST_ROW:50,BOTTOM:1070});
// There is no title line and no level text; the board's status line sits at STATUS and the rows start at TOP.
// o: {segments:[{key,name,color,on}], sectionOn, trigger:{show,label}, results:[{hex,name,text}], total, text:{...}}
export function simpleMenuLayout(o){
 const M=SIMPLE_MENU,t=o.text,w=[],X=M.X,label=(id,x,y,text,extra={})=>w.push({type:'label',id,x,y,text,...extra});
 const btn=(id,x,y,wd,text,on,extra={})=>w.push({type:'button',id,x,y,w:wd,h:M.BTN_H,label:text,on,...extra});
 const row=(id,y,name,color,on)=>{label(id+':name',X,y+40,name,{color,bold:true,size:34});btn(id+':show',440,y,250,t.show,on,{size:32,color:on?color:undefined});btn(id+':hide',710,y,250,t.hide,!on,{size:32})};
 let y=M.TOP;
 const segs=o.segments||[];
 if(!segs.length){label('noseg',X,y+40,t.noSeg);y+=M.ROW}
 for(const s of segs.slice(0,MAX_SEG_ROWS)){row('seg:'+s.key,y,s.name,s.color||'#fff',s.on);y+=M.ROW}
 if(segs.length>MAX_SEG_ROWS){label('seg:more',X,y+8,'… +'+(segs.length-MAX_SEG_ROWS),{size:24,color:'#9fb3c3'});y+=40}
 row('section',y,t.section,'#cfe3f0',!!o.sectionOn);y+=M.ROW;
 if(o.trigger?.show){
  // the trigger switch: the lit button is what the trigger does now, the line below says it in words
  const lab=!!o.trigger.label;
  label('trigger:name',X,y+40,t.trigger,{color:'#cfe3f0',bold:true,size:34});
  btn('trigger:point',440,y,250,t.trigPoint,!lab,{size:32,color:!lab?'#cfe3f0':undefined});btn('trigger:label',710,y,250,t.trigLabel,lab,{size:32,color:lab?'#cfe3f0':undefined});
  label('trigger:hint',X,y+M.BTN_H+22,lab?t.trigHintLabel:t.trigHintPoint,{size:24,color:'#ffd27a'});y+=M.TRIG_ROW;
 }
 const res=o.results||[];
 if(res.length){
  label('results',X,y+30,t.results,{bold:true,size:28});
  const top=y+56,cap=Math.max(0,Math.floor((M.BOTTOM-24-30-top)/M.LIST_ROW)),shown=res.slice(0,cap);
  shown.forEach((r,i)=>{const ry=top+i*M.LIST_ROW;
   w.push({type:'button',id:'result:'+i,x:X,y:ry,w:56,h:40,label:'',on:true,color:r.hex});
   label('result:'+i+':name',X+76,ry+30,r.name,{size:28,bold:true,color:r.hex});label('result:'+i+':vol',X+520,ry+30,r.text,{size:28})});
  const more=res.length-shown.length;
  label('total',X,top+shown.length*M.LIST_ROW+26,t.total+' '+o.total+' · '+res.length+(more>0?'  (… +'+more+')':''),{size:24,color:'#9fb3c3'});
 }
 // bottom row: equal buttons, the exit one red
 const items=[['home',t.home],['undo',t.undo],['all',t.all],['exit',t.exit]],gap=12,bw=Math.floor((M.W-2*X-(items.length-1)*gap)/items.length);
 items.forEach(([id,text],i)=>btn(id,X+i*(bw+gap),M.BOTTOM,bw,text,id==='exit',{size:28,...(id==='exit'?{color:'#b33'}:{})}));
 return w;
}
// greedy wrap that keeps Latin words whole (CJK text breaks between any two characters); measure(text) = width
export function wrapWords(text,maxW,measure){
 const tokens=String(text).match(/[\x21-\x7e]+|\s+|[^\s\x21-\x7e]/g)||[],lines=[];let cur='';
 for(const t of tokens){
  if(!cur&&/^\s+$/.test(t))continue;
  const cand=cur+t;if(!cur||measure(cand.trimEnd())<=maxW){cur=cand;continue}
  lines.push(cur.trimEnd());cur=/^\s+$/.test(t)?'':t;
 }
 if(cur.trim())lines.push(cur.trimEnd());
 return lines;
}
// the mission's steps (separated by ' → ') each start a line; later steps keep their arrow
export function missionLines(mission,maxW,measure){
 return String(mission).split(' → ').flatMap((s,i)=>wrapWords((i?'→ ':'')+s.trim(),maxW,measure));
}
