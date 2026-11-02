import {spawn} from 'node:child_process';
const migration=spawn(process.execPath,['scripts/db-migrate.mjs'],{stdio:'inherit'});
const code=await new Promise(resolve=>{migration.on('error',()=>resolve(1));migration.on('exit',resolve);});
if(code)process.exit(code||1);
const {start}=await import('../services/api/src/server.mjs');
try{start();}catch{console.error(JSON.stringify({event:'api_configuration_error'}));process.exitCode=1;}
