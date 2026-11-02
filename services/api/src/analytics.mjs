import {Prisma} from './database.mjs';
import {HttpError,videoDTO} from './domain.mjs';
const numbers=row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='bigint'?Number(v):v]));
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function createAnalytics({db,settings,now}){
 const table=name=>Prisma.raw(`"${db.appSchema||'public'}"."${name}"`);
 async function range(url,timezone){
  const preset=url.searchParams.get('preset')||'30d',at=now();let from,to;
  if(!['today','7d','30d','90d','all','custom'].includes(preset))throw new HttpError(400,'Select a valid analytics period.');
  if(preset==='custom'){
   const a=url.searchParams.get('from')||'',b=url.searchParams.get('to')||'';if(!validDate(a)||!validDate(b)||a>b)throw new HttpError(400,'Select a valid start and end date.');
   const [bounds]=await db.$queryRaw`SELECT (${a}::date::timestamp AT TIME ZONE ${timezone}) AS start,((${b}::date+1)::timestamp AT TIME ZONE ${timezone}) AS finish`;from=bounds.start;to=bounds.finish;
  }else if(preset==='all'){
   const [bounds]=await db.$queryRaw`SELECT LEAST(COALESCE((SELECT min("createdAt") FROM ${table('hh_users')}),${at}),COALESCE((SELECT min("qualifiedAt") FROM ${table('hh_video_views')}),${at}),COALESCE((SELECT min("activatedAt") FROM ${table('hh_memberships')}),${at}),COALESCE((SELECT min("createdAt") FROM ${table('hh_subscription_requests')}),${at})) AS start`;from=bounds.start;to=new Date(+at+1);
  }else{
   const days=preset==='today'?1:Number(preset.replace('d',''));
   const [bounds]=await db.$queryRaw`SELECT ((date_trunc('day',${at}::timestamptz AT TIME ZONE ${timezone})-(${days-1}::int*interval '1 day')) AT TIME ZONE ${timezone}) AS start`;from=bounds.start;to=new Date(+at+1);
  }
  to=new Date(Math.min(+to,+at+1));if(+from>=+to)throw new HttpError(400,'The selected dates must include past or current activity.');
  const days=(to-from)/86400000,bucket=days<=90?'day':days<=730?'week':days<=7300?'month':'year';return {preset,from,to,bucket,timezone};
 }
 async function analytics(url){
  const timezone=(await settings.get()).timezone,bounds=await range(url,timezone),{from,to,bucket}=bounds,at=now();
  const order={available:true};
  const results=await Promise.all([
   db.$queryRaw`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='ACTIVE')::int AS active,count(*) FILTER(WHERE status='SUSPENDED')::int AS suspended,count(*) FILTER(WHERE "createdAt">=${from} AND "createdAt"<${to})::int AS registrations FROM ${table('hh_users')}`,
   db.$queryRaw`SELECT count(*)::int AS total,count(*) FILTER(WHERE published AND available AND NOT "adminUnavailable")::int AS published,count(*) FILTER(WHERE NOT published)::int AS hidden,count(*) FILTER(WHERE NOT available OR "adminUnavailable")::int AS unavailable FROM ${table('hh_videos')}`,
   db.$queryRaw`SELECT count(*)::int AS total,count(*) FILTER(WHERE "qualifiedAt">=${from} AND "qualifiedAt"<${to})::int AS selected,count(DISTINCT "userId") FILTER(WHERE "qualifiedAt">=${from} AND "qualifiedAt"<${to})::int AS "signedInViewers",count(*) FILTER(WHERE "qualifiedAt">=(date_trunc('day',${at}::timestamptz AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone}))::int AS today,count(*) FILTER(WHERE "qualifiedAt">=(date_trunc('week',${at}::timestamptz AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone}))::int AS week,count(*) FILTER(WHERE "qualifiedAt">=(date_trunc('month',${at}::timestamptz AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone}))::int AS month FROM ${table('hh_video_views')}`,
   db.$queryRaw`SELECT count(*) FILTER(WHERE "revokedAt" IS NULL AND "expiresAt">${at})::int AS active,count(*) FILTER(WHERE "revokedAt" IS NULL AND "expiresAt"<=${at})::int AS expired,count(*) FILTER(WHERE "revokedAt" IS NOT NULL)::int AS revoked,count(*) FILTER(WHERE "activatedAt">=${from} AND "activatedAt"<${to})::int AS activations,count(*) FILTER(WHERE "expiresAt">=${from} AND "expiresAt"<${to} AND "revokedAt" IS NULL)::int AS expirations FROM ${table('hh_memberships')}`,
   db.$queryRaw`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='PENDING')::int AS pending,count(*) FILTER(WHERE status='APPROVED')::int AS approved,count(*) FILTER(WHERE status='REJECTED')::int AS rejected FROM ${table('hh_subscription_requests')} WHERE "createdAt">=${from} AND "createdAt"<${to}`,
   db.$queryRaw`WITH buckets AS (SELECT generate_series(date_trunc(${bucket},${from}::timestamptz AT TIME ZONE ${timezone}),date_trunc(${bucket},(${to}::timestamptz-interval '1 millisecond') AT TIME ZONE ${timezone}),('1 '||${bucket})::interval) AS local_start),v AS (SELECT date_trunc(${bucket},"qualifiedAt" AT TIME ZONE ${timezone}) AS local_start,count(*)::int AS n,count(DISTINCT "userId")::int AS active_users FROM ${table('hh_video_views')} WHERE "qualifiedAt">=${from} AND "qualifiedAt"<${to} GROUP BY 1),u AS (SELECT date_trunc(${bucket},"createdAt" AT TIME ZONE ${timezone}) AS local_start,count(*)::int AS n FROM ${table('hh_users')} WHERE "createdAt">=${from} AND "createdAt"<${to} GROUP BY 1),a AS (SELECT date_trunc(${bucket},"activatedAt" AT TIME ZONE ${timezone}) AS local_start,count(*)::int AS n FROM ${table('hh_memberships')} WHERE "activatedAt">=${from} AND "activatedAt"<${to} GROUP BY 1),e AS (SELECT date_trunc(${bucket},"expiresAt" AT TIME ZONE ${timezone}) AS local_start,count(*)::int AS n FROM ${table('hh_memberships')} WHERE "expiresAt">=${from} AND "expiresAt"<${to} AND "revokedAt" IS NULL GROUP BY 1) SELECT b.local_start::date::text AS date,coalesce(v.n,0) AS views,coalesce(v.active_users,0) AS "activeUsers",coalesce(u.n,0) AS registrations,coalesce(a.n,0) AS activations,coalesce(e.n,0) AS expirations,(SELECT count(*)::int FROM ${table('hh_memberships')} m WHERE m."activatedAt"<LEAST(((b.local_start+('1 '||${bucket})::interval) AT TIME ZONE ${timezone}),${to}::timestamptz) AND m."expiresAt">=LEAST(((b.local_start+('1 '||${bucket})::interval) AT TIME ZONE ${timezone}),${to}::timestamptz) AND (m."revokedAt" IS NULL OR m."revokedAt">=LEAST(((b.local_start+('1 '||${bucket})::interval) AT TIME ZONE ${timezone}),${to}::timestamptz))) AS "activeMemberships" FROM buckets b LEFT JOIN v USING(local_start) LEFT JOIN u USING(local_start) LEFT JOIN a USING(local_start) LEFT JOIN e USING(local_start) ORDER BY b.local_start`,
   db.$queryRaw`SELECT "videoId",count(*)::int AS views FROM ${table('hh_video_views')} WHERE "qualifiedAt">=${from} AND "qualifiedAt"<${to} GROUP BY "videoId" ORDER BY views DESC,"videoId" LIMIT 20`,
   db.$queryRaw`WITH totals AS (SELECT period,v."videoId",count(*)::int AS views,row_number() OVER(PARTITION BY period ORDER BY count(*) DESC,v."videoId") AS rank FROM (VALUES ('day'),('week'),('month')) p(period) JOIN ${table('hh_video_views')} v ON v."qualifiedAt">=(date_trunc(p.period,${at}::timestamptz AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone}) GROUP BY period,v."videoId") SELECT period,"videoId",views FROM totals WHERE rank<=12 ORDER BY period,rank`,
   db.membership.groupBy({by:['planName'],where:{revokedAt:null,expiresAt:{gt:at}},_count:{_all:true}}),
   db.video.findMany({where:{...order,durationSeconds:{not:null}},orderBy:[{durationSeconds:'desc'},{id:'asc'}],take:10}),
   db.subscriptionRequest.count({where:{status:'PENDING'}}),db.subscriptionRequest.count({where:{status:'APPROVED'}})
  ]);
  const [users,videos,views,memberships,requests,series,top,trend,distribution,longest,pendingRequests,approvedRequests]=results;
  const ids=[...new Set([...top,...trend].map(v=>v.videoId))],records=await db.video.findMany({where:{id:{in:ids}}}),map=new Map(records.map(v=>[v.id,v]));const ranked=rows=>rows.flatMap(r=>map.has(r.videoId)?[{...videoDTO(map.get(r.videoId)),views:r.views}]:[]);
  return {range:bounds,users:numbers(users[0]),videos:numbers(videos[0]),views:numbers(views[0]),memberships:numbers(memberships[0]),requests:{...numbers(requests[0]),approvalRate:requests[0].total?requests[0].approved/requests[0].total:0},pendingRequests,approvedRequests,series:series.map(numbers),topVideos:ranked(top),trending:Object.fromEntries(['day','week','month'].map(p=>[p,ranked(trend.filter(v=>v.period===p))])),packageDistribution:distribution.map(v=>({package:v.planName,active:v._count._all})),longest:longest.map(videoDTO)};
 }
 analytics.range=range;return analytics;
}
