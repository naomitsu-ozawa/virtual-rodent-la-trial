// build 626: 体験会モード (hands-on event mode). Pure: no DOM, no THREE, unit-tested (tests/unit/event-mode.test.js).
// Four levels, each one of the bundled practice datasets (docs/demo/sampleN, the same set ids as the practice-data chooser);
// texts are i18n keys (i18n.js). The switch is settings.eventMode (app-settings.js, per device, default off); the chosen
// level lives only in this page (a reload starts with none chosen) and follows whichever practice dataset was opened last.
export const EVENT_HINT_KEYS={section:'evHintSection',move:'evHintMove',toggle:'evHintToggle',mark:'evHintMark',distance:'evHintDistance'};
export const EVENT_LEVELS=Object.freeze([
 {id:'lv0',lv:0,sample:'sample4',nameKey:'evLv0Name',missionKey:'evLv0Mission',hints:['section','move'],segments:['bone']},
 {id:'lv1',lv:1,sample:'sample3',nameKey:'evLv1Name',missionKey:'evLv1Mission',hints:['section','move','toggle'],segments:['bone','soft','lung']},
 {id:'lv2',lv:2,sample:'sample2',nameKey:'evLv2Name',missionKey:'evLv2Mission',hints:['section','move','toggle'],segments:['bone','soft','fat'],labels:true},
 {id:'lv3',lv:3,sample:'sample1',nameKey:'evLv3Name',missionKey:'evLv3Mission',hints:['section','move','mark','distance'],segments:['bone','soft','fat']},
].map(l=>Object.freeze({...l,hints:Object.freeze(l.hints),segments:Object.freeze(l.segments)})));
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
// the VR かんたん menu's segment rows: the level's segments that the loaded data has shown (shown = active and enabled, in that order);
// no level chosen: every shown segment
export function simpleMenuSegments(level,shownKeys){const shown=[...(shownKeys||[])];return level?level.segments.filter(k=>shown.includes(k)):shown}
// its 解析結果のラベル row (the laser shows what it points at, the trigger pins / unpins a result's label, as in the 解析 tab): only with analysis
// results, and only for a level that uses them (Lv2) or with no level chosen; on from the start for such a level (off otherwise: in label mode
// the trigger pins labels instead of recording points, which Lv3 needs)
export const simpleMenuLabelsRow=(level,hasResults)=>!!hasResults&&(level?level.labels===true:true);
export const simpleMenuLabelsAtStart=level=>level?.labels===true;
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
