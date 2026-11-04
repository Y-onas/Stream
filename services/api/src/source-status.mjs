import {HttpError,isUUID} from './domain.mjs';
import {Prisma} from './database.mjs';

export async function reportSource(db,{videoId,status},at=new Date()){
 if(!isUUID(videoId)||!['AVAILABLE','TEMPORARY_UNAVAILABLE','PERMANENT_UNAVAILABLE'].includes(status))throw new HttpError(400,'Invalid source status.');
 const table=Prisma.raw(`"${db.appSchema||'public'}"."hh_videos"`);
 // Transient failures preserve catalogue visibility and access classification.
 // Store no raw Telegram errors, captions, private IDs or credentials.
 if(status==='TEMPORARY_UNAVAILABLE')await db.$executeRaw`UPDATE ${table} SET "sourceStatus"='TEMPORARY_UNAVAILABLE',"sourceFailures"=LEAST("sourceFailures"+1,10),"sourceRetryAt"=${at}::timestamptz+make_interval(secs=>LEAST(900,30*power(2,LEAST("sourceFailures",5)))) WHERE "publicId"=${videoId}::uuid AND available AND ("sourceRetryAt" IS NULL OR "sourceRetryAt"<=${at})`;
 else await db.video.updateMany({where:{publicId:videoId},data:{sourceStatus:status,available:status==='AVAILABLE',sourceRetryAt:null,sourceFailures:0}});
 return {recorded:true};
}
