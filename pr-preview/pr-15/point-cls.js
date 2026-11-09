// Classification bytes of the open volume (one channel per shown segment; f = 0.5 + distance-to-the-range-edge / 2048 as a byte, >= 128 means
// inside). Shared by VR (vr-view.js prepareVrData) and the 3D position-comment markers of the PC / iPad view (vr-point.js pointIsHidden
// marches over exactly these bytes). Pure: the segment state is passed in. t: {dims:[w,h,d], data: rg8-packed u16 volume}.
const SEGMENT_ORDER=['bone','soft','fat','lung']; // = the first four of segments.js SEGMENT_PRESET_ORDER (kept here so tests need no app state); the callers pass the GPU slot order (gpuSegmentOrder)
// classification bytes for a grid of at most 256 (see segmentIndexAt)
export function buildClsData(t,calibration,edit,segmentState,order=SEGMENT_ORDER){
 const [w,h,d]=t.dims,n=w*h*d,src=t.data,[slope,intercept,bias]=calibration;
 const segs=order.slice(0,4).map(k=>segmentState[k]);
 const chan=[-1,-1,-1,-1];let nc=0;segs.forEach((g,i)=>{if(g?.active&&g.enabled)chan[i]=nc++});
 if(!nc)return null;const C=nc===1?1:nc===2?2:4,out=new Uint8Array(n*C);
 const maskOk=edit.data&&edit.dims.join()===t.dims.join();
 for(let si=0;si<4;si++){
  const seg=segs[si];if(chan[si]<0)continue;const lo=+seg.min,hi=+seg.max,masked=maskOk&&(edit.active>>si&1),maskOnly=maskOk&&(edit.maskOnly>>si&1),ch=chan[si];
  for(let i=0;i<n;i++){
   const hu=((src[i*2]|(src[i*2+1]<<8))-bias)*slope+intercept,dd=Math.min(hu-lo,hi-hu);
   let f=Math.round((0.5+dd/2048)*255);f=f<0?0:f>255?255:f;
   if(masked){if(edit.data[i*4+si]<128)f=0;else if(maskOnly&&f<191)f=191}
   out[i*C+ch]=f;
  }
 }
 return{data:out,C,chan};
}
