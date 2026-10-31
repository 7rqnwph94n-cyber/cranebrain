/* CraneBrain on Cloudflare: provides the same storage interface the app used on Claude
   (db, assets, downloads, user), backed by this site's own /api, D1 database and R2 photo store. */
(()=>{
window.__CRANEBRAIN_CF=1;
const enc=encodeURIComponent;
const err=(code,msg)=>{const e=new Error(msg||code);e.code=code;return e};
async function req(method,url,body,type){let r;
 try{r=await fetch(url,{method,body,redirect:'manual',credentials:'same-origin',headers:body==null?{}:{'content-type':type||'application/json'}})}
 catch(e){throw err('unavailable','offline')}
 if(r.type==='opaqueredirect'||r.status===401||r.status===403){window.dispatchEvent(new Event('cranebrain-auth'));throw err('unauthenticated','signed out')}
 if(!r.ok)throw err(r.status>=500?'unavailable':'bad_request','server '+r.status);
 return r}
const strip=p=>String(p).replace(/^data\/users\/[^/]+\//,'');
function doc(path){const p=strip(path),i=p.lastIndexOf('/'),col=p.slice(0,i),id=p.slice(i+1);const q=`col=${enc(col)}&id=${enc(id)}`;
 return{path,id,
  async get(){const v=await (await req('GET','/api/doc?'+q)).json();return{exists:v!=null,id,data:()=>v==null?undefined:v}},
  async set(v){await req('PUT','/api/doc?'+q,JSON.stringify(v))},
  async update(v){const cur=await this.get();await this.set(Object.assign(cur.data()||{},v))},
  async delete(){await this.set({id,deleted:true,updatedAt:Date.now()})}}}
function collection(path){const col=strip(path);
 return{path,doc:id=>doc(path+'/'+id),
  async get(){const arr=await (await req('GET','/api/list?col='+enc(col))).json();const docs=arr.map(d=>({id:d.id,data:()=>d}));return{docs,size:docs.length,empty:!docs.length}}}}
const db={doc,collection};
const assets={async upload(blob,opts){const t=(opts&&opts.type)||blob.type||'image/jpeg';return (await req('POST','/api/photo',blob,t)).json()},async list(){return{assets:[],usage:{}}},async delete(){}};
const downloads={async save({filename,data}){const blob=data instanceof Blob?data:new Blob([data]);
 const file=new File([blob],filename,{type:blob.type||'application/octet-stream'});
 if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:filename});return}catch(e){if(e&&e.name==='AbortError')throw err('declined','cancelled')}}
 const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(u);a.remove()},10000)}};
const user={id:async()=>'me',isOwner:()=>true,canEdit:()=>true};
const caps={db,assets,downloads,user};
window.claude={use:async n=>caps[n]||null};
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
})();
