// the credit box of a practice dataset with a license notice (sample-credits.js): shown in the データ panel while that dataset is open
// (a 'vrl-event-sample-open' with its id), hidden when other data replaces it. Source and license are real links. Nothing is loaded from anywhere.
import { tr } from './i18n.js?v=20261106-build692';
import { sampleCredit } from './sample-credits.js?v=20261106-build692';
export function initSampleCreditUi(doc=document){
 let box=null,lastId=null;
 const el=(tag,cls,key)=>{const e=doc.createElement(tag);if(cls)e.className=cls;if(key){e.dataset.i18n=key;e.textContent=tr(key)}return e};
 const link=(url,text)=>{const a=doc.createElement('a');a.href=url;a.textContent=text;a.target='_blank';a.rel='noopener noreferrer';return a};
 const line=(labelKey,...parts)=>{const d=doc.createElement('div');d.append(el('span','',labelKey),...parts);return d};
 const build=c=>{
  const b=el('section','hint sample-credit');b.id='sample-credit';b.setAttribute('aria-labelledby','sample-credit-title');
  const title=el('div','','creditTitle');title.id='sample-credit-title';
  b.append(title,
   line('creditSource',el('span','',c.sourceKey),doc.createTextNode(' ('),link(c.sourceUrl,c.sourceUrl),doc.createTextNode(')')),
   line('creditLicense',link(c.licenseUrl,c.licenseName)),
   line('creditChanges',el('span','',c.changesKey)),
   el('div','',c.termsKey));
  return b;
 };
 const show=id=>{
  const c=sampleCredit(id);
  if(!c){box?.remove();box=null;lastId=null;return}
  if(box&&lastId===id)return;
  box?.remove();box=build(c);lastId=id;
  const host=doc.querySelector('[data-ipad-drawer-section="data"]')||doc.querySelector('.sidebar-scroll > .panel');
  const files=host?.querySelector('.ws-file-actions');
  if(files)files.after(box);else if(host)host.prepend(box);else doc.body.append(box);
 };
 doc.addEventListener('vrl-event-sample-open',e=>show(e.detail?.id));
 show(globalThis.__vrlOpenSample);
}
