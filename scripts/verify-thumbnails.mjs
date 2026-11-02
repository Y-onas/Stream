// Local acceptance check: generates previews through the authenticated real API.
// Writes only tiny JPEGs and a result summary, never video files or credentials.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {setTimeout} from 'node:timers/promises';
const config=JSON.parse(await readFile(new URL('../.local/runtime.json',import.meta.url),'utf8'));
const output=new URL('../.local/qa/',import.meta.url);await mkdir(output,{recursive:true});
const request=path=>fetch(new URL(path,config.apiOrigin),{headers:{'X-Gateway-Token':config.gatewayToken},signal:AbortSignal.timeout(10000)});
const catalogue=await request('/api/videos');if(!catalogue.ok)throw Error('Catalogue unavailable');
const results=[];
const selection=process.argv.slice(2);
for(const video of (await catalogue.json()).items.filter(video=>!selection.length||selection.includes(video.id.split('-').at(-1)))){
  const deadline=Date.now()+180000;let result;
  while(Date.now()<deadline){
    const response=await request(`/api/videos/${encodeURIComponent(video.id)}/thumbnail`);
    if(response.status===202){await response.body?.cancel();await setTimeout(2000);continue;}
    result={id:video.id,format:video.filename.split('.').at(-1),status:response.status};
    if(response.ok){
      const bytes=Buffer.from(await response.arrayBuffer());
      if(response.headers.get('content-type')!=='image/jpeg'||bytes[0]!==255||bytes[1]!==216)throw Error('Invalid preview response');
      await writeFile(new URL(`thumbnail-${video.id}.jpg`,output),bytes);result.imageBytes=bytes.length;
    }
    break;
  }
  results.push(result||{id:video.id,status:'timeout'});console.log(JSON.stringify(results.at(-1)));
  await writeFile(new URL('thumbnail-verification.json',output),JSON.stringify(results,null,2));
}
if(results.some(result=>result.status!==200))process.exitCode=1;
