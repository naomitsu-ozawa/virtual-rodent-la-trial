// Colours of the position points (build 472), shared by the VR markers / ring, the 3D overlay, the 2D marks and the comment list.
// No imports (comments.js uses it to check a saved colour). A point's colour is its own `color` ("#rrggbb", set by the user) or, when
// it has none, the AUTO colour: the palette entry for its stable key. The key is the N of the text 「VR ポイント N」 (the number given when
// it was recorded; never the list position, so deleting a point does not recolour the others) or, for any other text, a hash of the id.
// The palette keeps away from the colours that already mean something in VR: selection yellow, hover / rim white, the four section colours,
// the hand colours and the surface-cursor lime (POINT_RESERVED; tests/unit/point-colors.test.js checks the distance in CIE Lab).
// Hidden points are told apart by size / no rim, never by colour.
export const POINT_PALETTE=Object.freeze([
 {hex:'#19d3ee',ja:'シアン',en:'Cyan'},
 {hex:'#e23fe0',ja:'マゼンタ',en:'Magenta'},
 {hex:'#2fbf4f',ja:'緑',en:'Green'},
 {hex:'#b8743a',ja:'茶',en:'Brown'},
 {hex:'#1e88ff',ja:'青',en:'Blue'},
 {hex:'#ff3d8b',ja:'ピンク',en:'Pink'},
 {hex:'#12b5a0',ja:'ティール',en:'Teal'},
 {hex:'#a64dff',ja:'紫',en:'Violet'},
]);
export const POINT_RESERVED=Object.freeze({
 selected:'#ffd23d',hover:'#ffffff',rim:'#ffffff',
 sections:Object.freeze(['#f2d27a','#8ec5ff','#f5a3c7','#9be3b0']),
 hands:Object.freeze(['#ff7a3d','#7c6cff']),
 cursor:'#8dff4a',
});
export const POINT_RESERVED_LIST=Object.freeze([POINT_RESERVED.selected,POINT_RESERVED.hover,POINT_RESERVED.rim,...POINT_RESERVED.sections,...POINT_RESERVED.hands,POINT_RESERVED.cursor]);

const HEX=/^#[0-9a-f]{6}$/i;
// a valid colour as lower-case "#rrggbb", else null (anything untrusted: a project file, storage)
export const normalizeColor=v=>typeof v==='string'&&HEX.test(v.trim())?v.trim().toLowerCase():null;
const NAME_RE=/^(?:VR ポイント|VR point)\s+(\d+)$/i;
// FNV-1a, 32 bit
const hash=s=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}return h>>>0};
// a valid stored key: a non-negative integer (anything else from a file is dropped)
export const normalizeAutoKey=v=>Number.isSafeInteger(v)&&v>=0?v:null;
// the number a point of the OLD kind would be given from its text 「VR ポイント N」 (null for other texts)
export const textPointNumber=text=>{const m=NAME_RE.exec(String(text??'').trim());return m?Math.max(1,+m[1]):null};
// the stable key of a point (build 472): its stored `autoKey` (set when it was recorded: the N of 「VR ポイント N」 in VR, the next free number
// for a point added on the PC / iPad), so editing the text never changes the colour. A legacy point without one derives it once from its
// text (「VR ポイント N」 -> N) or the hash of its id; comments.js stores that derived key before the text is edited.
export function pointKey(c){
 const k=normalizeAutoKey(c?.autoKey);if(k!==null)return k;
 return textPointNumber(c?.text)??hash(String(c?.id??''))+1;
}
export const autoPointColor=c=>POINT_PALETTE[(((pointKey(c)-1)%POINT_PALETTE.length)+POINT_PALETTE.length)%POINT_PALETTE.length].hex;
// the colour to draw: the point's own colour, else the auto one
export const pointColor=c=>normalizeColor(c?.color)||autoPointColor(c);
export const colorToInt=hex=>parseInt((normalizeColor(hex)||'#000000').slice(1),16);
// the body of the solid VR sphere (the colour itself is the hidden dot and the chip): the same hue at 80 % brightness, so blue / violet / brown stay
// visible on the dark background at the small size (build 472)
export function darkFill(hex){
 const n=colorToInt(hex);
 return(Math.round((n>>16&255)*0.8)<<16)|(Math.round((n>>8&255)*0.8)<<8)|Math.round((n&255)*0.8);
}
// text colour on that colour: dark ink on a light colour, white on a dark one
export function inkOn(hex){
 const n=colorToInt(hex),r=(n>>16&255)/255,g=(n>>8&255)/255,b=(n&255)/255;
 return 0.2126*r+0.7152*g+0.0722*b>0.45?'#04202a':'#ffffff';
}
export const paletteName=(hex,language='ja')=>{const e=POINT_PALETTE.find(p=>p.hex===normalizeColor(hex));return e?(language==='en'?e.en:e.ja):''};
