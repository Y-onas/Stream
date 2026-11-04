import {readFile} from 'node:fs/promises';
let until=0,busy=false;
// Retained diagnostic helper; playback admission no longer calls this gate.
// Read only this container's cgroup. Do not inspect the host or evict playback.
export async function memoryPressure(){
 if(Date.now()<until)return busy;
 const [used,max]=await Promise.all(['/sys/fs/cgroup/memory.current','/sys/fs/cgroup/memory.max'].map(path=>readFile(path,'utf8').catch(()=>null)));
 busy=!!used&&!!max&&max.trim()!=='max'&&Number(used)/Number(max)>=.85;until=Date.now()+1000;return busy;
}
