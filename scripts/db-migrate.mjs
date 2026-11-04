import '../services/api/src/config.mjs';
import {spawn} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import {createDatabase} from '../services/api/src/database.mjs';
import {bootstrapAdministration} from '../services/api/src/settings.mjs';
import {seedPlans} from '../services/api/prisma/seed.mjs';
import {applicationConfig} from '../services/api/src/config.mjs';
if(!process.env.DATA_BASE_URL)throw Error('DATA_BASE_URL is required');
const child=spawn(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--config','services/api/prisma.config.ts'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
// Bound captured diagnostics and redact URLs/known secrets before saving. The
// migration CLI must never stream a datasource or credentials to service logs.
let output='';const capture=c=>{output=(output+c).slice(-262144);};child.stdout.on('data',capture);child.stderr.on('data',capture);
const code=await new Promise(resolve=>{child.on('error',()=>resolve(1));child.on('close',resolve);});
for(const name of ['DATA_BASE_URL','DATA_BASE_DIRECT_URL','CLERK_SECRET_KEY','STREAM_SERVICE_TOKEN','API_GATEWAY_TOKEN','TELEGRAM_API_HASH'])if(process.env[name])output=output.split(process.env[name]).join('[REDACTED]');
for(const name of ['DATA_BASE_URL','DATA_BASE_DIRECT_URL'])try{const url=new URL(process.env[name]);for(const password of [url.password,decodeURIComponent(url.password)])if(password)output=output.split(password).join('[REDACTED]');}catch{}
output=output.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi,'[REDACTED_DATABASE_URL]');
await mkdir('.local',{recursive:true});await writeFile('.local/migration-output.log',output,{mode:0o600});
if(code){console.error(JSON.stringify({event:'database_migration_failed',code:/P\d{4}/.exec(output)?.[0]||'MIGRATION_FAILED',details:'See private .local/migration-output.log'}));process.exitCode=1;}
else{const db=createDatabase();try{await seedPlans(db,applicationConfig().currency);const bootstrap=await bootstrapAdministration(db,applicationConfig());if(bootstrap.configurationRequired){console.error(JSON.stringify({event:'owner_bootstrap_required',message:'EMAIL is required to approve the first OWNER in this administrator-empty database.'}));process.exitCode=1;}else console.log(JSON.stringify({event:'database_migration_complete',status:'up-to-date',plans:await db.membershipPlan.count()}));}catch(error){console.error(JSON.stringify({event:'database_seed_failed',code:error.code||'SEED_FAILED'}));process.exitCode=1;}finally{await db.$disconnect();}}
