import {config as readDotenv} from 'dotenv';
import {fileURLToPath} from 'node:url';
const root=new URL('../../../',import.meta.url);
const allowed=['DATA_BASE_URL','DATA_BASE_DIRECT_URL','MEMBERSHIP_CURRENCY','TELEGRAM_SUPPORT_USERNAME','CLERK_PUBLIC_KEY','EMAIL','USER_NAME','CLERK_SECRET_KEY','CLERK_JWT_KEY','CLERK_PUBLISHABLE_KEY','ADMIN_ORIGIN','APP_TIMEZONE','DATABASE_POOL_MAX','DATABASE_SSL_MODE'];
export function loadApplicationEnv(){
  const values={};
  for(const path of [new URL('.env',root),new URL('.local/module4.env',root)])readDotenv({path:fileURLToPath(path),processEnv:values,override:true,quiet:true});
  for(const key of allowed)if(process.env[key]===undefined&&values[key]!==undefined)process.env[key]=values[key];
}
loadApplicationEnv();
export const applicationConfig=()=>({
  currency:process.env.MEMBERSHIP_CURRENCY||'ETB',
  supportUsername:process.env.TELEGRAM_SUPPORT_USERNAME||'',
  adminOrigin:process.env.ADMIN_ORIGIN||(process.env.NODE_ENV==='production'?process.env.PUBLIC_ORIGIN:'http://127.0.0.1:5174'),
  timezone:process.env.APP_TIMEZONE||'Africa/Nairobi',
  clerkSecretKey:process.env.CLERK_SECRET_KEY,
  clerkJwtKey:process.env.CLERK_JWT_KEY,
  clerkPublishableKey:process.env.CLERK_PUBLIC_KEY||process.env.CLERK_PUBLISHABLE_KEY||'',
  bootstrapEmail:process.env.EMAIL||'',
  bootstrapName:process.env.USER_NAME||'',
  publicOrigin:process.env.PUBLIC_ORIGIN
});

// Neon migrations need a session connection, while application queries keep pooling.
export function migrationDatabaseUrl(pooled,direct){
  if(direct)return direct;
  if(!pooled)return 'postgresql://build:build@127.0.0.1:5432/build';
  const url=new URL(pooled);
  if(/-pooler\..+\.neon\.tech$/.test(url.hostname)){url.hostname=url.hostname.replace('-pooler.','.');url.searchParams.delete('pgbouncer');return url.toString();}
  return pooled;
}
