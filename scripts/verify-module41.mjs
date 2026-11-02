import '../services/api/src/config.mjs';
import {createDatabase} from '../services/api/src/database.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {setTimeout} from 'node:timers/promises';
const config=JSON.parse(await readFile('.local/runtime.json','utf8')),db=createDatabase();
const request=path=>fetch(new URL(path,config.apiOrigin),{headers:{'X-Gateway-Token':config.gatewayToken},signal:AbortSignal.timeout(15000)});
try{
  await db.video.updateMany({where:{available:true,durationSeconds:null},data:{inspectionAttemptedAt:null}});
  const deadline=Date.now()+150000;let videos;
  do{videos=await db.video.findMany({where:{available:true},select:{id:true,durationSeconds:true,durationSource:true},orderBy:{durationSeconds:{sort:'desc',nulls:'last'}}});if(videos.length&&videos.every(v=>v.durationSeconds))break;await setTimeout(5000);}while(Date.now()<deadline);
  const longest=await (await request('/api/videos?sort=longest&limit=100')).json();
  const mostViewed=await (await request('/api/videos?sort=most-viewed&limit=100')).json();
  if(longest.source!=='postgresql'||!longest.items?.length||!mostViewed.items?.length)throw Error('Database catalogue unavailable');
  const measured=longest.items.filter(v=>v.durationSeconds!==null);if(new Set(measured.map(v=>v.durationSeconds)).size<2)throw Error('Different real durations not available');
  if(measured.some((v,i)=>i&&v.durationSeconds>measured[i-1].durationSeconds))throw Error('Longest ordering failed');
  const plans=await db.membershipPlan.findMany({select:{name:true,durationMonths:true,priceMinor:true,currency:true},orderBy:{sortOrder:'asc'}});
  const migrations=await db.$queryRaw`SELECT migration_name,finished_at FROM _prisma_migrations WHERE rolled_back_at IS NULL AND finished_at IS NOT NULL ORDER BY finished_at`;
  const report={checkedAt:new Date().toISOString(),migrations,plans,videos,qualifiedViews:await db.videoView.count(),registeredUsers:await db.user.count(),subscriptions:await db.subscriptionRequest.count(),memberships:await db.membership.count(),longestOrder:longest.items.map(v=>v.id),mostViewedOrder:mostViewed.items.map(v=>v.id),liveClerkVerified:false,livePaymentApproved:false};
  await mkdir('.local/qa',{recursive:true});await writeFile('.local/qa/module41-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify({videos:videos.length,measuredDurations:measured.length,plans:plans.length,qualifiedViews:report.qualifiedViews,source:longest.source,migrations:migrations.map(m=>m.migration_name)}));
}catch(error){console.error(JSON.stringify({event:'module41_live_check_failed',code:error.code||'VERIFICATION_FAILED',message:error.code?'Check database connectivity.':error.message}));process.exitCode=1;}finally{await db.$disconnect();}
