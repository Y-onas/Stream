import '../services/api/src/config.mjs';
import {createDatabase,Prisma} from '../services/api/src/database.mjs';
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
// Global admission settings are retired; configure only one playback's requests.
const values={sessionUpstreamLimit:Number(args.get('--per-session'))},note=args.get('--reason')||'';
if([...args.keys()].some(key=>!['--per-session','--reason'].includes(key))||![1,2].includes(values.sessionUpstreamLimit)||note.trim().length<3||note.length>4000)throw Error('Use --per-session 1|2 --reason "explanation". Global playback/upstream limits are retired.');
const db=createDatabase();try{
 const result=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${db.appSchema||'public'}:session-request-policy`}))::text`;
  const before=await tx.platformSettings.findUnique({where:{id:'platform'},select:{sessionUpstreamLimit:true}});
  await tx.platformSettings.upsert({where:{id:'platform'},create:{id:'platform',...values},update:{...values,version:{increment:1}}});
  await tx.adminAuditLog.create({data:{adminId:'deployment-operator',action:'SESSION_UPSTREAM_LIMIT_CONFIGURED',targetType:'PlatformSettings',targetId:'platform',before:before||Prisma.JsonNull,after:values,note:note.trim()}});
  return values;
 },{timeout:15000});console.log(JSON.stringify({event:'session_upstream_limit_configured',...result,existingSessionsPreserved:true}));
}finally{await db.$disconnect();}
