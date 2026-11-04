import {readFile,statfs} from 'node:fs/promises';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {activePlayback} from './playback-capacity.mjs';

export function createOperations({db,now}){
 let goProbe=async()=>null;
 const loop=monitorEventLoopDelay({resolution:50});loop.enable();let cpu=process.cpuUsage(),at=performance.now();
 const requests={total:0,failed:0,authorizationFailures:0,interrupted:0};
 const read=path=>readFile(path,'utf8').catch(()=>null);let previousContainerCPU=null,previousContainerAt=null;
 async function snapshot(){
  const time=performance.now(),next=process.cpuUsage(),used=(next.user+next.system-cpu.user-cpu.system)/1000/Math.max(1,time-at);cpu=next;at=time;
  const [memoryMax,memoryCurrent,io,network,disk,sessions,upstreams,workers,connections,budget,go,cpuStat]=await Promise.all([
   read('/sys/fs/cgroup/memory.max'),read('/sys/fs/cgroup/memory.current'),read('/sys/fs/cgroup/io.stat'),read('/proc/net/dev'),statfs(process.cwd()).catch(()=>null),
   db.playbackSession.count({where:activePlayback(now())}),
   db.upstreamLease.count({where:{kind:{in:['MEDIA','DISCOVERY']},expiresAt:{gt:now()}}}),
   db.upstreamLease.count({where:{kind:'METADATA',expiresAt:{gt:now()}}}),
   db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND application_name='habeshan-hub-api'`,
   db.platformSettings.findUnique({where:{id:'platform'},select:{sessionUpstreamLimit:true}}),goProbe().catch(()=>null),read('/sys/fs/cgroup/cpu.stat')
  ]);
  const memory=process.memoryUsage(),ioTotals={readBytes:0,writeBytes:0};if(io)for(const line of io.split('\n')){ioTotals.readBytes+=Number(/\brbytes=(\d+)/.exec(line)?.[1]||0);ioTotals.writeBytes+=Number(/\bwbytes=(\d+)/.exec(line)?.[1]||0);}
  const net={receivedBytes:0,sentBytes:0};if(network)for(const line of network.split('\n')){const parts=line.split(':');if(parts.length!==2||parts[0].trim()==='lo')continue;const values=parts[1].trim().split(/\s+/);net.receivedBytes+=Number(values[0]||0);net.sentBytes+=Number(values[8]||0);}
  const cpuMicros=Number(/^usage_usec (\d+)$/m.exec(cpuStat||'')?.[1]),sampleAt=performance.now();let containerCPU=null;
  if(Number.isFinite(cpuMicros)){if(previousContainerCPU!==null&&cpuMicros>=previousContainerCPU&&sampleAt>previousContainerAt)containerCPU=(cpuMicros-previousContainerCPU)/1000/(sampleAt-previousContainerAt);previousContainerCPU=cpuMicros;previousContainerAt=sampleAt;}
  const warnings=[];if(memoryMax&&memoryMax.trim()!=='max'&&Number(memoryCurrent)/Number(memoryMax)>.8)warnings.push('API container memory exceeds 80% of its ceiling.');if(go?.container?.memoryLimitBytes&&go.container.memoryBytes/go.container.memoryLimitBytes>.8)warnings.push('Go container memory exceeds 80% of its ceiling.');if(disk&&Number(disk.bavail)/Number(disk.blocks)<.15)warnings.push('Hub filesystem has less than 15% free space.');
  return {sampledAt:now(),scope:'Habeshan HUB process/container only; no host or unrelated-project inspection',go,api:{rss:memory.rss,heapUsed:memory.heapUsed,cpuCoresUsed:used,containerCPU,eventLoopDelayMs:Number.isFinite(loop.mean)?loop.mean/1e6:null,containerMemoryBytes:memoryCurrent?Number(memoryCurrent):null,containerMemoryLimitBytes:memoryMax&&memoryMax.trim()!=='max'?Number(memoryMax):null,io:io?ioTotals:null,network:network?net:null},disk:disk?{totalBytes:Number(disk.blocks)*Number(disk.bsize),freeBytes:Number(disk.bavail)*Number(disk.bsize)}:null,sessions,upstreams,metadataWorkers:workers,databaseConnections:connections[0].count,policy:{globalPlaybackLimit:null,globalUpstreamLimit:null,vipSessionsPerAccount:2,sessionUpstreamLimit:budget?.sessionUpstreamLimit??2},requests:{...requests},warnings};
 }
 let cached=null,until=0,work=null;
 return {requests,setGoProbe(fn){goProbe=fn;},async get(){if(cached&&Date.now()<until)return cached;if(work)return work;work=snapshot().then(data=>{cached=data;until=Date.now()+10000;return data;}).finally(()=>{work=null;});return work;},close(){loop.disable();}};
}
