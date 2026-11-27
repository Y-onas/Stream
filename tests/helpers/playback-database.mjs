import pg from 'pg';
import {randomBytes,generateKeyPairSync} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {createDatabase} from '../../services/api/src/database.mjs';
import {migrationDatabaseUrl} from '../../services/api/src/config.mjs';

export async function isolatedDatabase(t,prefix='hh43_test'){
 const schema=`${prefix}_${randomBytes(8).toString('hex')}`,connection={connectionString:migrationDatabaseUrl(process.env.DATA_BASE_URL,process.env.DATA_BASE_DIRECT_URL),connectionTimeoutMillis:10000};
 async function control(run){const client=new pg.Client(connection);client.on('error',()=>{});await client.connect();try{return await run(client);}finally{await client.end();}}
 await control(async client=>{await client.query(`CREATE SCHEMA "${schema}"`);try{for(const entry of (await readdir('services/api/prisma/migrations',{withFileTypes:true})).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))){const sql=await readFile(`services/api/prisma/migrations/${entry.name}/migration.sql`,'utf8');await client.query(sql.replace('BEGIN;',`BEGIN; SET LOCAL search_path="${schema}";`));}}catch(error){await client.query('ROLLBACK');await client.query(`DROP SCHEMA "${schema}" CASCADE`);throw error;}});
 const db=createDatabase(process.env.DATA_BASE_URL,{schema});
 t.after(async()=>{await db.$disconnect();await control(client=>client.query(`DROP SCHEMA "${schema}" CASCADE`));});return db;
}
export function httpClient(origin,{gateway='g'.repeat(40),admin=false,adminToken}={}){
 if(adminToken)admin=true;
 const jar=new Map();let csrf='';
 function remember(response){for(const item of response.headers.getSetCookie()){const fields=item.split(';').map(v=>v.trim()),i=fields[0].indexOf('='),name=fields[0].slice(0,i),value=fields[0].slice(i+1),path=fields.find(v=>/^Path=/i.test(v))?.slice(5)||'/';if(fields.some(v=>/^Max-Age=0$/i.test(v)))jar.delete(name+'|'+path);else jar.set(name+'|'+path,{name,value,path});}}
 return {jar,csrf:()=>csrf,cookie(name,path='/'){return jar.get(name+'|'+path)?.value;},
  async request(path,{method='GET',data,headers={},signal}={}){
   const cookie=[...jar.values()].filter(v=>v.path==='/'||path===v.path||path.startsWith(v.path+'/')).map(v=>v.name+'='+v.value).join(';');
   const response=await fetch(origin+path,{method,signal,headers:{'X-Gateway-Token':gateway,Origin:admin?'http://admin.test':'http://viewer.test',...(admin?{Authorization:`Bearer ${adminToken||'test-owner'}`}:{}) ,...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(data!==undefined?{body:JSON.stringify(data)}:{})});remember(response);return response;
  },
  async call(path,options){const response=await this.request(path,options),type=response.headers.get('content-type')||'',body=type.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer());if(body?.csrfToken!==undefined)csrf=body.csrfToken;return{status:response.status,body,headers:response.headers};}
 };
}
export function testPlaybackConfig(){const pair=generateKeyPairSync('rsa',{modulusLength:2048});return{sessionUpstreamLimit:2,playbackPrivateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}),playbackPublicKey:pair.publicKey.export({type:'spki',format:'pem'})};}
// Earlier acceptance scenarios keep readable source fixture labels. Translate
// those labels to public IDs on the wire, and use the new grant protocol for
// their media requests. The dedicated 4.3 suite asserts opaque responses as-is.
export async function scenarioClientFactory(db,origin){
 const records=await db.video.findMany({select:{id:true,publicId:true}}),publicIds=new Map(records.map(v=>[v.id,v.publicId])),sourceIds=new Map(records.map(v=>[v.publicId,v.id]));
 const normalize=value=>typeof value==='string'?(sourceIds.get(value)||value):Array.isArray(value)?value.map(normalize):value&&typeof value==='object'&&!Buffer.isBuffer(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,normalize(item)])):value;
 return(adminToken)=>{const client=httpClient(origin,{adminToken});return{async call(route,options={}){
  let wire=route.replace(/(?:channel|group)-\d+-\d+/g,id=>publicIds.get(id)||id);
  const media=/^\/api\/videos\/([^/]+)\/stream$/.exec(wire);
  let ticket;
  if(media&&['GET','HEAD'].includes(options.method||'GET')){const grant=await client.call('/api/playback/authorize',{method:'POST',data:{videoId:media[1],position:0}});if(grant.status!==201)return grant;wire=grant.body.streamUrl;ticket=grant.body.id;}
  const result=await client.call(wire,options);
  // Earlier media checks finish their complete small response in this call;
  // release that request's playback ticket rather than leaking artificial slots.
  if(ticket)await client.call(`/api/playback/${ticket}/terminate`,{method:'POST',data:{}});
  return{...result,body:normalize(result.body)};
 }};};
}
