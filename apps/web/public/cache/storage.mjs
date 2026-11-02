const MiB = 1024 * 1024;
const defaults = () => ({key:'settings',limit:128*MiB,total:0,generation:0,enabled:true});
export class SegmentStore {
  constructor(factory = globalThis.indexedDB, name = 'phonofilm-segments-v1') {this.factory=factory; this.name=name; this.db=null;}
  async open() {
    if(this.db) return this.db;
    if(!this.factory) throw new Error('Browser storage is unavailable');
    return this.db = await new Promise((resolve,reject)=>{
      const request=this.factory.open(this.name,1);
      request.onupgradeneeded=()=>{const db=request.result;const store=db.createObjectStore('segments',{keyPath:'key'});store.createIndex('used','used');db.createObjectStore('settings',{keyPath:'key'});};
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();this.db=null;};resolve(request.result);};
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('Browser storage is blocked'));
    });
  }
  async transaction(stores, mode, execute) {
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(stores,mode); let output;
      tx.oncomplete=()=>resolve(output);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('Storage transaction aborted'));
      try {execute(tx,value=>{output=value;});} catch(error){tx.abort();reject(error);}
    });
  }
  settings() {return this.transaction(['settings'],'readonly',(tx,done)=>{const req=tx.objectStore('settings').get('settings');req.onsuccess=()=>done(req.result || defaults());});}
  get(key) {return this.transaction(['segments'],'readwrite',(tx,done)=>{const store=tx.objectStore('segments');const req=store.get(key);req.onsuccess=()=>{const item=req.result;if(item){item.used=Date.now();store.put(item);}done(item);};});}
  put(item,generation) {
    return this.transaction(['segments','settings'],'readwrite',(tx,done)=>{
      const store=tx.objectStore('segments'), settings=tx.objectStore('settings');
      const req=settings.get('settings');req.onsuccess=()=>{
        const state=req.result || defaults();
        if(!state.enabled || state.generation!==generation || item.data.byteLength>state.limit){done(false);return;}
        const old=store.get(item.key);old.onsuccess=()=>{
          if(old.result) {done(true);return;}
          const commit=()=>{store.put({...item,used:Date.now()});state.total+=item.data.byteLength;settings.put(state);done(true);};
          if(state.total+item.data.byteLength<=state.limit) {commit();return;}
          const cursor=store.index('used').openCursor();cursor.onsuccess=()=>{
            const entry=cursor.result;
            if(entry && state.total+item.data.byteLength>state.limit){state.total-=entry.value.data.byteLength;entry.delete();entry.continue();}
            else commit();
          };
        };
      };
    });
  }
  configure({limit,enabled,clear=false}={}) {
    return this.transaction(['segments','settings'],'readwrite',(tx,done)=>{
      const settings=tx.objectStore('settings'),store=tx.objectStore('segments');const req=settings.get('settings');req.onsuccess=()=>{
        const state=req.result || defaults();
        if(limit!==undefined){if(!Number.isSafeInteger(limit)||limit<MiB||limit>512*MiB){tx.abort();return;}state.limit=limit;}
        if(enabled!==undefined)state.enabled=!!enabled;
        if(clear || enabled===false){store.clear();state.total=0;state.generation++;}
        const finish=()=>{settings.put(state);done(state);};
        if(state.total<=state.limit){finish();return;}
        const cursor=store.index('used').openCursor();cursor.onsuccess=()=>{const entry=cursor.result;if(entry && state.total>state.limit){state.total-=entry.value.data.byteLength;entry.delete();entry.continue();}else finish();};
      };
    });
  }
}
