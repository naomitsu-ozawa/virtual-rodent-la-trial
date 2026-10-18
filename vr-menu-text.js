// Pure helpers of the VR menu's text layout (build 528/529): no THREE, no DOM, unit-tested (tests/unit/vr-menu-wrap.test.js).
// build 528: greedy line wrap for a menu label: at ' · ' separators while a line fits maxW (measure(text) = width), a single part wider than maxW is split by characters
export function wrapMenuText(text,maxW,measure){
 const parts=String(text).split(' · '),lines=[];let cur='';
 const push=p=>{if(measure(p)<=maxW){lines.push(p);return}let seg='';for(const ch of p){if(seg&&measure(seg+ch)>maxW){lines.push(seg);seg=ch}else seg+=ch}if(seg)lines.push(seg)};
 for(const p of parts){const cand=cur?cur+' · '+p:p;if(cur&&measure(cand)>maxW){push(cur);cur=p}else cur=cand}
 if(cur)push(cur);return lines;
}
// build 529: rows of wrapped lines stacked from top; when they would pass bottom, every row's line height (and the caller's font) is scaled down by
// the returned factor so the block still ends above bottom. rows: [{n: lines, lh}] -> {ys: baseline of each row's first line, scale, gap}
export function stackMenuRows(rows,top,bottom,gap=6){
 const total=rows.reduce((a,r)=>a+r.n*r.lh,0)+gap*Math.max(0,rows.length-1);
 const scale=total>bottom-top?Math.max(0.5,(bottom-top)/total):1,ys=[];let y=top;
 for(const r of rows){ys.push(Math.round(y));y+=r.n*r.lh*scale+gap*scale}
 return{ys,scale};
}
