// Non-overlapping segments (no voxel counted in two segments; priority = the order of the segment cards,
// top first). Pure kernel + small state; segments.js holds the segment state.
//
// Each segment keeps the range the user set (userMin / userMax, what the sliders show); the range every view, the
// runs, the analysis and the export use is seg.min / seg.max. With the mode 'priority' a segment's range is its user
// range minus the ranges held by the ACTIVE segments above it in the card order (hidden-by-checkbox segments still
// count, so hiding a card never moves another segment's voxels). 'off' = the user ranges as they are (overlaps allowed,
// the behaviour before 438; projects saved before 438 load with it).
//
// Ranges are inclusive ([min, max], as every reader compares v >= min && v <= max); a range cut at a higher segment's
// max b starts at the next float32 above b, so a filtered (non-integer) value can never fall into a gap between them.
// When a higher range lies strictly inside a lower one, two pieces remain; the app holds one range per segment, so the
// piece containing the middle of the user range is kept (else the larger) and the dropped piece is reported.
const f32=new Float32Array(1),u32=new Uint32Array(f32.buffer);
// next float32 above / below x (x finite)
export function nextUp(x){f32[0]=x;if(f32[0]<=x){if(f32[0]===0){u32[0]=1}else if(f32[0]>0)u32[0]+=1;else u32[0]-=1}return f32[0]}
export function nextDown(x){f32[0]=x;if(f32[0]>=x){if(f32[0]===0){u32[0]=0x80000001}else if(f32[0]>0)u32[0]-=1;else u32[0]+=1}return f32[0]}

// segs: {key: {userMin, userMax, active, takes?, adds?}}; order: keys top → bottom.
// Returns {key: {min, max, empty, dropped:[[a,b],…], sources:[key…], legacy:{min,max,empty,dropped}}}.
//
// (the higher segment wins, and what it adds or removes — Closing, hole filling, small-component
// removal, air boundary, manual edits — also moves the segments below it, in every view): a segment is either
//  - plain (takes !== false): nothing but its range decides its voxels, so the range itself is taken from the lower
//    ones (min/max, as before);
//  - a voxel taker (takes === false: it has post-processing or manual edits): its final voxels are subtracted from the
//    lower segments voxel by voxel, so its range is NOT taken from them; the lower segment lists it in `sources`.
// min/max are the range after the plain upper segments only. `sources` = the active upper segments whose final voxels
// are subtracted from this one voxel by voxel: the voxel takers whose range overlaps this one's, or either side can ADD
// voxels outside its range (adds: Closing or hole filling) — and when THIS segment adds, every active upper segment,
// plain ones included, since what it adds may lie on any of them (the reference is the upper segment's final voxels,
// so a plain upper segment's final voxels are its range minus its own sources). `legacy` = the old result
// (every active upper segment taken by range), kept for the checks. With takes omitted every segment is plain.
export function effectiveRanges(segs,order,mode){
 const out={},taken=[],legacyTaken=[],uppers=[];
 const cut=(s,list)=>{
  let pieces=[[+s.userMin,+s.userMax]];const dropped=[];
  if(mode==='priority'&&s.active)for(const [a,b] of list){
   const next=[];
   for(const [lo,hi] of pieces){
    if(b<lo||a>hi){next.push([lo,hi]);continue}
    if(lo<a)next.push([lo,nextDown(a)]);
    if(hi>b)next.push([nextUp(b),hi]);
   }
   pieces=next;
  }
  let keep=null;
  if(pieces.length===1)keep=pieces[0];
  else if(pieces.length>1){
   const mid=(+s.userMin+ +s.userMax)/2;keep=pieces.find(([lo,hi])=>lo<=mid&&mid<=hi)||pieces.reduce((a,b)=>(b[1]-b[0]>a[1]-a[0]?b:a));
   for(const p of pieces)if(p!==keep)dropped.push(p);
  }
  return{keep,res:keep?{min:keep[0],max:keep[1],empty:false,dropped}:{min:+s.userMin,max:nextDown(+s.userMin),empty:true,dropped:[]}};
 };
 for(const key of order){
  const s=segs[key];if(!s)continue;
  const {keep,res}=cut(s,taken),leg=cut(s,legacyTaken);
  const sources=[];
  if(mode==='priority'&&s.active&&!res.empty)for(const u of uppers){
   // a segment that adds voxels (Closing / hole filling) may add them anywhere, on a plain upper segment's range too
   if(s.adds||(u.takes===false&&(u.adds||!(u.hi<res.min||u.lo>res.max))))sources.push(u.key);
  }
  out[key]={...res,sources,legacy:leg.res};
  // what this segment really holds is taken from the ones below (a piece it dropped stays free for them)
  if(s.active&&leg.keep)legacyTaken.push([leg.keep[0],leg.keep[1]]);
  if(s.active&&keep){
   uppers.push({key,lo:keep[0],hi:keep[1],adds:!!s.adds,takes:s.takes!==false});
   if(s.takes!==false)taken.push([keep[0],keep[1]]);
  }
 }
 return out;
}
