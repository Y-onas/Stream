import {HttpError,supportContact} from './domain.mjs';
export function canonicalEmail(value){if(typeof value!=='string'||value.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))throw new HttpError(400,'Enter a valid administrator email.');return value.trim().toLowerCase();}
export function settingsDefaults(config){return {id:'platform',platformName:'Habeshan HUB',defaultCurrency:config.currency||'ETB',timezone:config.timezone||'Africa/Nairobi',registrationOpen:true,maintenanceMode:false,maintenanceMessage:'We are carrying out maintenance. Please try again shortly.',streamingAccess:'PUBLIC',supportUsername:supportContact(config.supportUsername)||null,supportDisplayName:null,version:0};}
export function publicSettings(s){return {platformName:s.platformName,currency:s.defaultCurrency,timezone:s.timezone,registrationOpen:s.registrationOpen,maintenanceMode:s.maintenanceMode,maintenanceMessage:s.maintenanceMessage,streamingAccess:s.streamingAccess,supportUsername:s.supportUsername?`@${s.supportUsername}`:null,supportUrl:s.supportUsername?`https://t.me/${s.supportUsername}`:null,supportDisplayName:s.supportDisplayName};}
export function createSettings(db,config){let cache=null,until=0;return {invalidate(){cache=null;until=0;},async get(){if(cache&&Date.now()<until)return cache;cache=await db.platformSettings.findUnique({where:{id:'platform'}})||settingsDefaults(config);until=Date.now()+1000;return cache;}};}
// Called by scripts/db-migrate.mjs after migrations and before API startup.
// Run this in the controlled migration step, never independently in replicas.
// Local setup runs npm run db:migrate before npm run runtime:api.
export async function bootstrapAdministration(db,config){
  const defaults=settingsDefaults(config);
  return db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${db.appSchema||'public'}:administrators`}))::text`;
    const settings=await tx.platformSettings.upsert({where:{id:'platform'},create:defaults,update:{}});
    if(settings.adminBootstrapAt)return {created:false};
    if(await tx.administrator.count()){await tx.platformSettings.update({where:{id:'platform'},data:{adminBootstrapAt:new Date()}});return {created:false};}
    if(!config.bootstrapEmail)return {created:false,configurationRequired:true};
    const email=canonicalEmail(config.bootstrapEmail),name=(config.bootstrapName||'Administrator').trim();
    if(!name||name.length>80)throw new HttpError(400,'Initial administrator name must be 1–80 characters.');
    const admin=await tx.administrator.create({data:{email,name,role:'OWNER',status:'ACTIVE',createdBy:'system-bootstrap'}});
    await tx.platformSettings.update({where:{id:'platform'},data:{adminBootstrapAt:new Date()}});
    await tx.adminAuditLog.create({data:{adminId:'system-bootstrap',action:'INITIAL_ADMINISTRATOR_CREATED',targetType:'Administrator',targetId:admin.id,after:{email,name,role:'OWNER',status:'ACTIVE'},note:'One-time administrator bootstrap from configured email.'}});
    return {created:true};
  },{timeout:15000});
}
