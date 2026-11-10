// The analysis regions as a TREE under their parent segment (the browser segment cards and the VR segment menu): pure data builders, no DOM, no three.js, unit-tested
// (tests/unit/segment-tree.test.js). A region hangs under the first of its segments that the tree knows (a merged region of bone + fat is under bone, listed once);
// the order of a segment's children is the order of the analysis list. A row = what the view draws: colour, display name, shown flag, focus.
import { regionVisible } from './region-visibility.js?v=20261110-build706';
export const TREE_COLLAPSE_OVER=8; // the browser's tree starts collapsed when a segment has more regions than this
export const treeDefaultExpanded=count=>count<=TREE_COLLAPSE_OVER;
// the segment a region is listed under, or null (no segment of it is in the tree: such a region stays only in the analysis list)
export function treeParentKey(region,segmentKeys){
 const keys=region?.segmentKeys;if(!Array.isArray(keys))return null;
 return keys.find(k=>segmentKeys.includes(k))??null;
}
// regions: the analysis list; segmentKeys: the tree's segments in their display order; nameOf(region): the display name (analysis-results.js analysisRegionName);
// segmentsShown(region) (optional): false while every segment of the region is unticked (the toggle rests then); focusedId: the focused region's id
// -> [{ key, count, rows:[{ id, name, color, visible, canToggle, focused }] }] only for segments that have regions, in segmentKeys order
export function buildSegmentTree(regions,{segmentKeys,nameOf,segmentsShown=null,focusedId=null}){
 const groups=new Map();
 for(const r of regions||[]){
  const key=treeParentKey(r,segmentKeys);if(key==null)continue;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push({id:r.id,name:String(nameOf(r)),color:r.color,visible:regionVisible(r),canToggle:segmentsShown?!!segmentsShown(r):true,focused:r.id===focusedId});
 }
 return segmentKeys.filter(k=>groups.has(k)).map(key=>({key,count:groups.get(key).length,rows:groups.get(key)}));
}
// one page of a list: {items, page (clamped), pages, from, to (exclusive)}
export function treePage(items,page,per){
 const n=items.length,size=Math.max(1,per|0),pages=Math.max(1,Math.ceil(n/size)),p=Math.min(pages-1,Math.max(0,page|0));
 return{items:items.slice(p*size,p*size+size),page:p,pages,from:p*size,to:Math.min(n,p*size+size)};
}
// VR: the segment rows and (under each segment that has regions) its region rows as ONE list cut into pages by height. groups = [{key, rows}] for the segments shown in the menu (in
// order; rows = [] for a segment without regions); segH / rowH = line heights, avail = the height of a page. A page that starts inside a segment's children repeats the
// segment's own line first (the children are never without their parent); a segment line is never the last line of a page while its children follow.
// -> pages: [[{type:'seg', key} | {type:'row', key, row}]]
export function pageTreeLines(groups,{segH,rowH,avail,expanded=true}){
 const pages=[[]];let used=0;
 const cur=()=>pages[pages.length-1];
 const add=(line,h)=>{cur().push(line);used+=h};
 const next=()=>{pages.push([]);used=0};
 for(const g of groups){
  const rows=expanded?g.rows:[];
  if(used+segH>avail&&cur().length)next();
  // the segment line must come with its first child
  if(rows.length&&used+segH+rowH>avail&&cur().length)next();
  add({type:'seg',key:g.key},segH);
  for(const row of rows){
   if(used+rowH>avail){next();add({type:'seg',key:g.key,cont:true},segH)}
   add({type:'row',key:g.key,row},rowH);
  }
 }
 return pages;
}
// text cut to maxW with an ellipsis (measure(text) = width)
export function ellipsize(text,maxW,measure){
 const s=String(text);if(measure(s)<=maxW)return s;
 let lo=0,hi=s.length;while(lo<hi){const mid=(lo+hi+1)>>1;if(measure(s.slice(0,mid)+'…')<=maxW)lo=mid;else hi=mid-1}
 return s.slice(0,lo)+'…';
}
