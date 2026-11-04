import {config as readDotenv} from 'dotenv';
import {fileURLToPath} from 'node:url';
const root=new URL('../../../',import.meta.url);
const allowed=['DATA_BASE_URL','DATA_BASE_DIRECT_URL','MEMBERSHIP_CURRENCY','TELEGRAM_SUPPORT_USERNAME','CLERK_PUBLIC_KEY','EMAIL','CLERK_SECRET_KEY','CLERK_JWT_KEY','CLERK_PUBLISHABLE_KEY','ADMIN_ORIGIN','APP_TIMEZONE','DATABASE_POOL_MAX','PLAYBACK_PRIVATE_KEY_PATH','PLAYBACK_PUBLIC_KEY_PATH','PLAYBACK_GRANT_TTL_SECONDS','PLAYBACK_ISSUER','PLAYBACK_AUDIENCE','PLAYBACK_KEY_ID','PLAYBACK_PREVIOUS_KEYS_PATH','PLAYBACK_CLOCK_TOLERANCE_SECONDS','PLAYBACK_SESSION_UPSTREAM_LIMIT','PLAYBACK_DRAIN','PUBLIC_ORIGIN','STREAM_ORIGIN','STREAM_SERVICE_TOKEN','API_GATEWAY_TOKEN','API_HOST','API_PORT','FFMPEG_PATH'];
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
  // USER_NAME belongs to the Telegram account, not the administrator identity.
  // Existing administrator display names stay in PostgreSQL.
  bootstrapName:'',
  publicOrigin:process.env.PUBLIC_ORIGIN,
  playbackPrivateKeyPath:process.env.PLAYBACK_PRIVATE_KEY_PATH||fileURLToPath(new URL('.local/playback-private.pem',root)),
  playbackPublicKeyPath:process.env.PLAYBACK_PUBLIC_KEY_PATH||fileURLToPath(new URL('.local/playback-public.pem',root)),
  playbackTTL:Number(process.env.PLAYBACK_GRANT_TTL_SECONDS||300),
  playbackIssuer:process.env.PLAYBACK_ISSUER||'habeshan-hub',
  playbackAudience:process.env.PLAYBACK_AUDIENCE||'habeshan-stream',
  playbackKeyId:process.env.PLAYBACK_KEY_ID||'',
  playbackPreviousKeysPath:process.env.PLAYBACK_PREVIOUS_KEYS_PATH||'',
  playbackClockTolerance:Number(process.env.PLAYBACK_CLOCK_TOLERANCE_SECONDS||30),
  sessionUpstreamLimit:Number(process.env.PLAYBACK_SESSION_UPSTREAM_LIMIT||1),
  playbackDrain:process.env.PLAYBACK_DRAIN==='1'
});

// Neon migrations need a session connection, while application queries keep pooling.
export function migrationDatabaseUrl(pooled,direct){
  if(direct)return direct;
  if(!pooled)return undefined;
  const url=new URL(pooled);
  if(/-pooler\..+\.neon\.tech$/.test(url.hostname)){url.hostname=url.hostname.replace('-pooler.','.');url.searchParams.delete('pgbouncer');return url.toString();}
  return pooled;
}
