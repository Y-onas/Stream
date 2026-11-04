import {createPlaybackGrants} from './playback-grants.mjs';

export class ConfigurationError extends Error{}
export function validateProductionEnvironment(env,config){
 const required=name=>{if(typeof env[name]!=='string'||!env[name].trim())throw new ConfigurationError(`${name} is required in production.`);return env[name];};
 const database=required('DATA_BASE_URL');let dbURL;
 try{dbURL=new URL(database);if(!['postgres:','postgresql:'].includes(dbURL.protocol)||!dbURL.hostname||!dbURL.username||!dbURL.password||dbURL.pathname==='/')throw Error();}catch{throw new ConfigurationError('DATA_BASE_URL must be a PostgreSQL connection URL with credentials and a database name.');}
 if(!['localhost','127.0.0.1','postgres','database'].includes(dbURL.hostname)&&!['require','verify-ca','verify-full'].includes(dbURL.searchParams.get('sslmode'))&&dbURL.searchParams.get('ssl')!=='true')throw new ConfigurationError('DATA_BASE_URL must explicitly use provider-supported TLS for an external PostgreSQL server.');
 function origin(name,value){let url;try{url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.origin!==value)throw Error();}catch{throw new ConfigurationError(`${name} must be an exact HTTPS origin without a path or credentials.`);}return url;}
 const publicOrigin=required('PUBLIC_ORIGIN');origin('PUBLIC_ORIGIN',publicOrigin);origin('ADMIN_ORIGIN',config.adminOrigin);
 const upstream=required('STREAM_ORIGIN');try{const url=new URL(upstream);if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error();}catch{throw new ConfigurationError('STREAM_ORIGIN must be a private HTTP(S) service origin without credentials or a path.');}
 const stream=required('STREAM_SERVICE_TOKEN'),gateway=required('API_GATEWAY_TOKEN');if(stream.length<32||gateway.length<32||stream===gateway)throw new ConfigurationError('STREAM_SERVICE_TOKEN and API_GATEWAY_TOKEN must be independent secrets of at least 32 characters.');
 if(!/^pk_live_[A-Za-z0-9+/=_-]+$/.test(config.clerkPublishableKey||''))throw new ConfigurationError('CLERK_PUBLIC_KEY (or existing CLERK_PUBLISHABLE_KEY alias) must be a production pk_live_ key for production startup.');
 if(!/^sk_live_[A-Za-z0-9+/=_-]+$/.test(config.clerkSecretKey||''))throw new ConfigurationError('CLERK_SECRET_KEY must be a production sk_live_ key for production startup and server-side identity/session checks.');
 const port=Number(env.API_PORT||3000),pool=Number(env.DATABASE_POOL_MAX||8);if(!Number.isInteger(port)||port<1||port>65535)throw new ConfigurationError('API_PORT must be an integer from 1 to 65535.');
 if(!Number.isInteger(pool)||pool<1||pool>32)throw new ConfigurationError('DATABASE_POOL_MAX must be an integer from 1 to 32.');
 if(![1,2].includes(config.sessionUpstreamLimit))throw new ConfigurationError('PLAYBACK_SESSION_UPSTREAM_LIMIT must be 1 or 2.');
 try{new Intl.DateTimeFormat('en',{timeZone:config.timezone});}catch{throw new ConfigurationError('APP_TIMEZONE must be a valid IANA timezone.');}
 if(!/^[A-Z]{3}$/.test(config.currency||''))throw new ConfigurationError('MEMBERSHIP_CURRENCY must be a three-letter currency code.');
 if(config.bootstrapEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.bootstrapEmail.trim()))throw new ConfigurationError('EMAIL must be a valid first-owner approval email when supplied.');
 required('PLAYBACK_PRIVATE_KEY_PATH');required('PLAYBACK_PUBLIC_KEY_PATH');
 try{if(!createPlaybackGrants(config).configured)throw Error();}catch{throw new ConfigurationError('PLAYBACK_PRIVATE_KEY_PATH, PLAYBACK_PUBLIC_KEY_PATH and optional previous-key settings must identify readable, valid matching signing keys.');}
 return {valid:true,httpsRequired:true,migrationsAutomatic:false,clerkDevelopmentKeys:config.clerkPublishableKey.startsWith('pk_test_')};
}
