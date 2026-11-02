import '../services/api/src/config.mjs';
import {spawn} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import {createDatabase} from '../services/api/src/database.mjs';
import {bootstrapAdministration} from '../services/api/src/settings.mjs';
import {seedPlans} from '../services/api/prisma/seed.mjs';
import {applicationConfig} from '../services/api/src/config.mjs';
if(!process.env.DATA_BASE_URL)throw Error('DATA_BASE_URL is required');
const child=spawn(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--config','services/api/prisma.config.ts'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
const code=await new Promise(resolve=>{child.on('error',()=>resolve(1));child.on('close',resolve);});
await mkdir('.local',{recursive:true});await writeFile('.local/migration-output.log',output,{mode:0o600});
if(code){console.error(JSON.stringify({event:'database_migration_failed',code:/P\d{4}/.exec(output)?.[0]||'MIGRATION_FAILED',details:'See private .local/migration-output.log'}));process.exitCode=1;}
else{const db=createDatabase();try{await seedPlans(db,applicationConfig().currency);await bootstrapAdministration(db,applicationConfig());console.log(JSON.stringify({event:'database_migration_complete',status:'up-to-date',plans:await db.membershipPlan.count()}));}catch(error){console.error(JSON.stringify({event:'database_seed_failed',code:error.code||'SEED_FAILED'}));process.exitCode=1;}finally{await db.$disconnect();}}
