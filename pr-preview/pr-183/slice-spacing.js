// Slice-spacing check (pure, no DOM). Volumes are voxel count x the three spacings, so a wrong Z spacing
// (missing / duplicated slices, uneven spacing) silently skews every volume. This module measures every
// consecutive gap along the slice normal, classifies what is wrong and picks the spacing to use.
//
// Thresholds (documented in the PR; exported so tests and the UI agree):
//  - duplicate:    gap <= max(1e-3 mm, 5% of the median gap)
//  - missing:      gap > 1.5 x median gap; missing slices = round(gap / median) - 1 (at least 1)
//  - non-uniform:  (max - min) of the regular gaps (neither duplicate nor missing) > max(1% of the median, 2e-3 mm).
//                  The absolute floor stops positions printed to 3 decimals (rounding = 1e-3 mm per gap) from
//                  being flagged on very thin slices (e.g. 0.0187 mm).
//  - duplicates are EXCLUDED from the volume (the slice with the smaller InstanceNumber, else read order, is kept),
//    unless every gap is a duplicate (positions carry no information then; nothing is dropped).
//  - spacing used: (last - first) / (N - 1) over the slices that remain. With missing slices that formula is wrong, so a
//    least-squares line of position vs corrected index (index + cumulative missing count) is used: it uses every slice,
//    so rounding of the printed positions averages out and one odd gap cannot dominate (the mean of the regular gaps
//    ignores the information of the slices around each gap).
//  - tag mismatch: |median - SpacingBetweenSlices| > 2% of the median (SliceThickness is only recorded:
//                  thickness legitimately differs from spacing for overlapping / gapped reconstructions)
export const SPACING_THRESHOLDS={dupAbsMm:1e-3,dupRel:0.05,missingRel:1.5,uniformRel:0.01,uniformAbsMm:2e-3,tagRel:0.02,mixedOrientationDot:0.9999};

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
function rawNormal(o){
 if(!o||o.length<6)return null;
 const r=o.slice(0,3),c=o.slice(3,6),n=[r[1]*c[2]-r[2]*c[1],r[2]*c[0]-r[0]*c[2],r[0]*c[1]-r[1]*c[0]],len=Math.hypot(...n);
 return len>1e-6&&n.every(Number.isFinite)?n.map(v=>v/len):null;
}
// Unit normal of an orientation, sign-neutral (cross product of the row and column directions).
export const sliceNormal=rawNormal;
// Normal oriented so that sorting by it matches the order the app used before (ascending Z) wherever Z is
// the dominant axis (axial). For coronal / sagittal (Z not dominant) the sign is chosen so the projected
// ascending order follows InstanceNumber (else read order). slices: in READ order (before sorting).
export function seriesNormal(slices){
 const o=slices.find(s=>s.orientation)?.orientation,n=rawNormal(o);
 if(!n)return null;
 const[ax,ay,az]=n.map(Math.abs);
 if(az>=ax&&az>=ay)return n[2]<0?n.map(v=>-v):n;
 const pts=[];slices.forEach((s,i)=>{if(s.pos)pts.push([dot(s.pos,n),Number.isFinite(s.instance)?s.instance:i])});
 if(pts.length<2)return n;
 const mp=pts.reduce((a,p)=>a+p[0],0)/pts.length,mi=pts.reduce((a,p)=>a+p[1],0)/pts.length;
 let cov=pts.reduce((a,p)=>a+(p[0]-mp)*(p[1]-mi),0);
 if(Math.abs(cov)<1e-12){ // no usable InstanceNumber order: use read order
  const mk=(pts.length-1)/2;cov=0;slices.filter(s=>s.pos).forEach((s,k)=>{cov+=(dot(s.pos,n)-mp)*(k-mk)});
 }
 return cov<0?n.map(v=>-v):n;
}
// Orientation tags that disagree inside one series (or only some slices have one).
export function mixedOrientation(slices){
 const ns=slices.map(s=>rawNormal(s.orientation));
 const have=ns.filter(Boolean);
 if(!have.length)return false;
 if(have.length!==ns.length)return true;
 return have.some(n=>Math.abs(dot(n,have[0]))<SPACING_THRESHOLDS.mixedOrientationDot);
}
// Position of a slice along the series normal (ImageOrientationPatient present) or Z (fallback = previous behaviour).
export function slicePosition(meta,normal){
 if(!meta?.pos)return null;
 return normal?dot(meta.pos,normal):meta.pos[2];
}
const median=a=>{const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};

// the spacing the app used before build 469 (first two slices by Z, else the tag value); kept to recognise old projects
function legacyZOf(slices,tagZ){
 const a=slices[0],b=slices[1];
 return a?.pos&&b?.pos?(Math.abs(b.pos[2]-a.pos[2])||tagZ):tagZ;
}
// slices: slice metas ALREADY sorted (groupSeries). normal: the oriented normal used for the sort
// (undefined = derive it from the slices).
export function analyzeSliceSpacing(slices,fallbackMm=1,normal=undefined){
 const T=SPACING_THRESHOLDS,f=slices[0]||{},tagBetween=f.spacingBetween>0?f.spacingBetween:null,tagThickness=f.thickness>0?f.thickness:null;
 const tagZ=tagBetween||tagThickness||fallbackMm;
 if(normal===undefined)normal=seriesNormal(slices);
 const orientationMixed=mixedOrientation(slices);
 const base={method:normal?'normal':'z',slices:slices.length,gaps:0,used:tagZ,basis:'tag',medianGap:null,minGap:null,maxGap:null,spreadPct:0,duplicates:0,missing:0,missingGaps:[],nonUniform:false,tagSpacingBetween:tagBetween,tagThickness,spacingBetweenMismatch:false,thicknessDiffers:false,orientationMixed,positionsIncomplete:false,info:false,duplicateIndices:[],allDuplicates:false,duplicatesExcluded:0,legacyZ:legacyZOf(slices,tagZ),warn:orientationMixed};
 if(slices.length<2)return base;
 // multi-frame: positions are synthesised from the tag spacing, so there is nothing to verify
 if(slices.some(s=>s.syntheticPos))return{...base,method:'frames',basis:'frames',warn:orientationMixed};
 const pos=slices.map(s=>slicePosition(s,normal)),have=pos.filter(p=>p!=null&&Number.isFinite(p)).length;
 if(have===0)return{...base,method:'none',info:true};
 if(have<pos.length){ // partial: keep the previous behaviour (first two slices when both have a position, else the tag value)
  const a=pos[0],b=pos[1],first=a!=null&&b!=null?Math.abs(b-a):0;
  return{...base,method:'partial',positionsIncomplete:true,info:true,used:first>T.dupAbsMm?first:tagZ,basis:first>T.dupAbsMm?'first-gap':'tag'};
 }
 const gaps=[];for(let i=1;i<pos.length;i++)gaps.push(Math.abs(pos[i]-pos[i-1]));
 // reference gap: median of the non-duplicate gaps (a majority of duplicates must not drag it to 0)
 const pos0=gaps.filter(g=>g>T.dupAbsMm),ref=median(pos0.length?pos0:gaps);
 if(!(ref>T.dupAbsMm))return{...base,gaps:gaps.length,duplicates:gaps.length,allDuplicates:true,warn:true,medianGap:ref};
 let duplicates=0,missing=0;const missingGaps=[],regular=[],duplicateIndices=[];
 gaps.forEach((g,i)=>{
  if(g<=Math.max(T.dupAbsMm,T.dupRel*ref)){duplicates++;duplicateIndices.push(i+1)}
  else if(g>T.missingRel*ref){const n=Math.max(1,Math.round(g/ref)-1);missing+=n;missingGaps.push({index:i,gap:g,missing:n})}
  else regular.push(g);
 });
 const med=median(regular.length?regular:pos0),range=regular.length?Math.max(...regular)-Math.min(...regular):0,spread=range/med;
 const nonUniform=range>Math.max(T.uniformRel*med,T.uniformAbsMm);
 const spacingBetweenMismatch=tagBetween!=null&&Math.abs(med-tagBetween)>T.tagRel*med;
 const thicknessDiffers=tagThickness!=null&&Math.abs(med-tagThickness)>T.tagRel*med;
 const clean=!duplicates&&!missing&&!nonUniform;
 // spacing: whole span / (N-1); with missing slices a least-squares fit against the corrected index (see header)
 const n=pos.length,shift=new Array(n).fill(0);
 for(const m of missingGaps)for(let k=m.index+1;k<n;k++)shift[k]+=m.missing;
 let used,basis;
 if(missing){
  const c=pos.map((_,k)=>k+shift[k]),mc=c.reduce((a,b)=>a+b,0)/n,mp=pos.reduce((a,b)=>a+b,0)/n;
  let sxy=0,sxx=0;for(let k=0;k<n;k++){sxy+=(c[k]-mc)*(pos[k]-mp);sxx+=(c[k]-mc)**2}
  used=Math.abs(sxy/sxx);basis='fit';
 }else{used=Math.abs(pos[n-1]-pos[0])/(n-1);basis='span'}
 return{...base,method:normal?'normal':'z',gaps:gaps.length,used,basis,medianGap:med,minGap:Math.min(...gaps),maxGap:Math.max(...gaps),spreadPct:spread*100,duplicates,duplicateIndices,missing,missingGaps,nonUniform,spacingBetweenMismatch,thicknessDiffers,warn:!clean||spacingBetweenMismatch||orientationMixed};
}
// Drop duplicate slices (indices from analyzeSliceSpacing().duplicateIndices, a slice that repeats its predecessor).
// Of each run of equal-position slices the one with the smaller InstanceNumber (else the earlier read order) stays.
// readIndex: Map slice -> position in read order.
export function excludeDuplicateSlices(sorted,duplicateIndices,readIndex){
 const dup=new Set(duplicateIndices),drop=new Set();
 for(let i=0;i<sorted.length;i++){
  if(dup.has(i))continue;
  let j=i;while(dup.has(j+1))j++;
  if(j===i)continue;
  let best=i;
  for(let k=i+1;k<=j;k++){
   const a=sorted[best],b=sorted[k],ia=Number.isFinite(a.instance)?a.instance:Infinity,ib=Number.isFinite(b.instance)?b.instance:Infinity;
   if(ib<ia||(ib===ia&&(readIndex?.get(b)??k)<(readIndex?.get(a)??best)))best=k;
  }
  for(let k=i;k<=j;k++)if(k!==best)drop.add(k);
 }
 return{slices:sorted.filter((_,k)=>!drop.has(k)),excluded:drop.size};
}

const r2=n=>(Math.round(n*100)/100).toString(),r3=n=>(Math.round(n*1000)/1000).toString();
// Warning text (null when nothing to report): {level:'warn'|'info', ja, en, jaSummary, enSummary, jaDetail, enDetail}.
export function spacingWarningText(check){
 if(!check||(!check.warn&&!check.info))return null;
 const u=r3(check.used);
 if(!check.warn){
  const ja='位置情報'+(check.method==='partial'?'が不完全':'なし')+'のためタグ値 '+u+' mm を使用（未検証）',
   en=(check.method==='partial'?'Slice positions are incomplete':'No slice positions')+': using the tag value '+u+' mm (unverified)';
  return{level:'info',ja,en,jaSummary:ja,enSummary:en,jaDetail:'',enDetail:''};
 }
 const ja=[],en=[],jd=[],ed=[];
 if(check.missing){
  const shift=r2(check.missing*(check.medianGap||check.used));
  ja.push('抜け '+check.missing+' 枚');en.push(check.missing+' missing');
  jd.push('抜けた部分は体積に含まれません（過小評価）。抜けより後ろは表示位置が約 '+shift+' mm ずれます');
  ed.push('The missing part is not included in the volume (underestimate). Slices after a gap are displayed about '+shift+' mm off');
 }
 if(check.duplicates){
  if(check.duplicatesExcluded){
   ja.push('重複 '+check.duplicatesExcluded+' 枚を除外しました');en.push('Excluded '+check.duplicatesExcluded+' duplicate slice(s)');
   jd.push('重複スライスはボリュームから除外しました（InstanceNumber の小さい方を残しています）');
   ed.push('Duplicate slices were removed from the volume (the one with the smaller InstanceNumber is kept)');
  }else{
   ja.push('重複 '+check.duplicates+' 枚');en.push(check.duplicates+' duplicate');
   jd.push('すべてのスライスの位置が同じため除外できず、体積は信頼できません');
   ed.push('All slices share one position, so none could be excluded and the volume is not reliable');
  }
 }
 if(check.nonUniform){
  ja.push('間隔のばらつき '+r2(check.spreadPct)+'%');en.push('spacing spread '+r2(check.spreadPct)+'%');
  jd.push('間隔が不均一なため、'+(check.basis==='fit'?'抜けを補正したフィット':'全体の平均')+' '+u+' mm による近似'+(check.basis==='span'?'。局所的な構造では近似です':''));
  ed.push('Spacing is uneven, so the '+(check.basis==='fit'?'gap-corrected fit':'overall mean')+' '+u+' mm is an approximation'+(check.basis==='span'?'. It is only approximate for local structures':''));
 }
 if(check.spacingBetweenMismatch){
  ja.push('SpacingBetweenSlices（'+r3(check.tagSpacingBetween)+' mm）と不一致');en.push('differs from SpacingBetweenSlices ('+r3(check.tagSpacingBetween)+' mm)');
 }
 if(check.orientationMixed){ja.push('シリーズ内で向き（ImageOrientationPatient）が不揃い');en.push('orientation tags differ within the series')}
 const howJa=check.basis==='fit'?'抜けを補正したフィット間隔 ':check.basis==='span'?'全体の平均間隔 ':'',howEn=check.basis==='fit'?'the gap-corrected fit spacing ':check.basis==='span'?'the overall mean spacing ':'';
 const jaS='スライス間隔に不整合があります：'+ja.join('、')+'。体積は'+howJa+u+' mm で計算しています',
  enS='Slice spacing is inconsistent: '+en.join(', ')+'. Volumes are computed with '+howEn+u+' mm';
 return{level:'warn',ja:jaS+(jd.length?'。'+jd.join('。'):''),en:enS+(ed.length?'. '+ed.join('. '):''),jaSummary:jaS,enSummary:enS,jaDetail:jd.join('。'),enDetail:ed.join('. ')};
}
// Compact record saved in the .vrlab project (optional field `spacingCheck`; informational, never applied on load).
export function spacingCheckForProject(check){
 if(!check)return null;
 const{missingGaps,...rest}=check;
 return{...rest,missingGaps:(missingGaps||[]).slice(0,50)};
}
// DOM-free HTML for a warning (details expandable; summary is one line). esc: HTML escaper.
export function spacingWarningHtml(check,lang,esc){
 const w=spacingWarningText(check);if(!w)return'';
 const ja=lang==='ja',sum=ja?w.jaSummary:w.enSummary,det=ja?w.jaDetail:w.enDetail;
 const cls='spacing-warn'+(w.level==='info'?' spacing-info':'');
 if(!det)return'<span class="'+cls+'" role="status">'+(w.level==='info'?'ⓘ ':'⚠ ')+esc(sum)+'</span>';
 return'<details class="'+cls+'" role="status"><summary>⚠ '+esc(sum)+'</summary>'+esc(det)+'</details>';
}
