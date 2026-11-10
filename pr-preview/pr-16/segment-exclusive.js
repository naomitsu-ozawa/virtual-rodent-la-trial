const f32=new Float32Array(1),u32=new Uint32Array(f32.buffer);
// next float32 above / below x (x finite)
export function nextUp(x){f32[0]=x;if(f32[0]<=x){if(f32[0]===0){u32[0]=1}else if(f32[0]>0)u32[0]+=1;else u32[0]-=1}return f32[0]}
export function nextDown(x){f32[0]=x;if(f32[0]>=x){if(f32[0]===0){u32[0]=0x80000001}else if(f32[0]>0)u32[0]-=1;else u32[0]+=1}return f32[0]}

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
