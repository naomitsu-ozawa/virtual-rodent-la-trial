// Pack per-slice analysis runs into one blob and back (for run-cache.js).
// Pure; unit-tested in tests/unit/run-pack.test.js.
export const RUNS_FORMAT=1;

// runs: one Uint32Array of (y, x0, x1) triples per slice.
// Layout (Uint32): [format, slices, offset_0 .. offset_slices, data...]
export function packRuns(runs){
 const d=runs.length;let total=0;for(const r of runs)total+=r?.length||0;
 const out=new Uint32Array(2+d+1+total);out[0]=RUNS_FORMAT;out[1]=d;let at=0;
 for(let z=0;z<d;z++){out[2+z]=at;const r=runs[z];if(r?.length){out.set(r,3+d+at);at+=r.length}}
 out[2+d]=at;return new Uint8Array(out.buffer);
}
export function unpackRuns(bytes,expectedSlices=null){
 const buf=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
 if(buf.byteLength%4||buf.byteLength<12)return null;
 const u=new Uint32Array(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)),d=u[1];
 if(u[0]!==RUNS_FORMAT||(expectedSlices!=null&&d!==expectedSlices)||u.length<3+d||u[2+d]!==u.length-3-d)return null;
 const out=new Array(d);for(let z=0;z<d;z++)out[z]=u.slice(3+d+u[2+z],3+d+u[3+z]);
 return out;
}
