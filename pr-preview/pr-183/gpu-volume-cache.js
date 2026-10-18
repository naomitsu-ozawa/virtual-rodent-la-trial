// Device-local cache of GPU volume texture contents (stage 2 of the save plan).
// Stores exactly the bytes uploaded to the volume texture — per texture slice,
// at the device's texture plan (iPad reduced / Mac full) — for filtered data,
// so "Rebuild 3D" with the same data + filters + plan skips filtering,
// packing and resampling. Browser storage can be evicted (Safari), so this is
// only a cache; project files are the record.
//
// IndexedDB layout: 'entries' {key, bytes, slices, bytesPerSlice, info,
// complete, created, lastUsed}; 'slices' keyed [key, index] -> Uint8Array.
const DB_NAME='vrl-gpu-volume-cache',DB_VERSION=1,FORMAT=1;

export async function cacheKey(parts){
 const text=JSON.stringify({format:FORMAT,...parts}),data=new TextEncoder().encode(text);
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',data));
 return[...hash].map(b=>b.toString(16).padStart(2,'0')).join('');
}

const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
const done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('aborted'))});

export async function openVolumeCache({indexedDB=globalThis.indexedDB,now=()=>Date.now()}={}){
 if(!indexedDB)throw new Error('IndexedDB unavailable');
 const open=indexedDB.open(DB_NAME,DB_VERSION);
 open.onupgradeneeded=()=>{const db=open.result;if(!db.objectStoreNames.contains('entries'))db.createObjectStore('entries',{keyPath:'key'});if(!db.objectStoreNames.contains('slices'))db.createObjectStore('slices')};
 const db=await req(open);
 const range=key=>IDBKeyRange.bound([key,0],[key,Number.MAX_SAFE_INTEGER]);
 async function entries(){const tx=db.transaction('entries');return req(tx.objectStore('entries').getAll())}
 async function remove(key){const tx=db.transaction(['entries','slices'],'readwrite');tx.objectStore('entries').delete(key);tx.objectStore('slices').delete(range(key));await done(tx)}
 return{
  // complete entry or null; refreshes lastUsed for LRU
  async lookup(key){
   const tx=db.transaction('entries','readwrite'),store=tx.objectStore('entries'),e=await req(store.get(key));
   if(!e?.complete){await done(tx);return null}
   e.lastUsed=now();store.put(e);await done(tx);return e;
  },
  async read(key,index){const tx=db.transaction('slices');return req(tx.objectStore('slices').get([key,index]))},
  // start (or restart) an entry; it becomes visible to lookup() only after commit()
  async begin(key,{slices,bytesPerSlice,info={}}){
   await remove(key);
   const tx=db.transaction('entries','readwrite');
   tx.objectStore('entries').put({key,slices,bytesPerSlice,bytes:slices*bytesPerSlice,info,complete:false,created:now(),lastUsed:now()});
   await done(tx);
   let written=0;
   return{
    async write(index,bytes){const t=db.transaction('slices','readwrite');t.objectStore('slices').put(bytes,[key,index]);await done(t);written++},
    async commit(){
     if(written!==slices)throw new Error(`cache entry incomplete (${written}/${slices})`);
     const t=db.transaction('entries','readwrite'),s=t.objectStore('entries'),e=await req(s.get(key));
     if(e){e.complete=true;e.lastUsed=now();s.put(e)}await done(t);
    },
    async abort(){try{await remove(key)}catch{}},
   };
  },
  remove,
  // all entries (settings > cache list, auto-prune of old filter settings)
  list:entries,
  async usage(){return(await entries()).reduce((a,e)=>a+(e.bytes||0),0)},
  // drop stale incomplete entries, then least recently used ones over budget
  async prune(budgetBytes,{keep=null,staleMs=10*60*1000}={}){
   const all=await entries(),t=now();
   for(const e of all)if(!e.complete&&e.key!==keep&&t-e.created>staleMs)await remove(e.key);
   const live=(await entries()).filter(e=>e.complete).sort((a,b)=>a.lastUsed-b.lastUsed);
   let total=live.reduce((a,e)=>a+e.bytes,0);
   for(const e of live){if(total<=budgetBytes)break;if(e.key===keep)continue;await remove(e.key);total-=e.bytes}
   return total;
  },
  async clear(){const tx=db.transaction(['entries','slices'],'readwrite');tx.objectStore('entries').clear();tx.objectStore('slices').clear();await done(tx)},
  close(){db.close()},
 };
}

// Adapter used by MedicalVolumeRenderer.ensure(): on a hit, read(i) returns the
// stored texture slice; on a miss, write(i) stores each uploaded slice and
// commit() publishes the entry. Storage errors (quota, eviction) disable the
// handle instead of failing the upload.
export async function textureCacheHandle(cache,key,{slices,bytesPerSlice,info}){
 const hit=await cache.lookup(key);
 if(hit&&hit.slices===slices&&hit.bytesPerSlice===bytesPerSlice)
  return{hit:true,async read(i){const b=await cache.read(key,i);if(!b||b.byteLength!==bytesPerSlice)throw new Error('cache slice missing');return b instanceof Uint8Array?b:new Uint8Array(b)},async write(){},async commit(){},
  // an upload that failed while reading a hit drops the (possibly damaged) entry
  async abort(){try{await cache.remove(key)}catch{}}};
 let writer=null,broken=false;
 try{writer=await cache.begin(key,{slices,bytesPerSlice,info})}catch{broken=true}
 return{
  hit:false,
  get broken(){return broken},
  async read(){throw new Error('not cached')},
  async write(i,bytes){if(broken)return;try{await writer.write(i,bytes)}catch{broken=true;await writer.abort()}},
  async commit(){if(broken)return false;try{await writer.commit();return true}catch{broken=true;await writer.abort();return false}},
  async abort(){if(writer)await writer.abort()},
 };
}

// settings > cache > auto-prune (build 296): entries of the same dataset (and
// the same 3D resolution for volumes) made with another filter setting are
// dropped when a new one is stored. Entries without this info (older builds)
// are left to the LRU budget.
export async function pruneOtherFilterSettings(cache,{kind,dataset,plan=null,filter},keep){
 if(globalThis.__vrlSettings?.get?.('cacheAutoPrune')===false)return;
 try{for(const e of await cache.list()){const i=e.info||{};if(e.key!==keep&&i.kind===kind&&i.dataset===dataset&&(plan==null||i.plan===plan)&&i.filter!=null&&i.filter!==filter)await cache.remove(e.key)}}catch(e){console.warn('Cache auto-prune failed.',e)}
}
