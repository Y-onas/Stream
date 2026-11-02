import '../services/api/src/config.mjs';
import {migrationDatabaseUrl} from '../services/api/src/config.mjs';
import pg from 'pg';
const db=new pg.Client({connectionString:migrationDatabaseUrl(process.env.DATA_BASE_URL,process.env.DATA_BASE_DIRECT_URL),connectionTimeoutMillis:10000});
try{await db.connect();const result=await db.query(`SELECT l.pid,a.state,EXTRACT(EPOCH FROM (now()-a.state_change))::int AS idle_seconds,(a.usename=current_user) AS same_role,l.granted FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND l.objid=72707369 AND a.datname=current_database()`);console.log(JSON.stringify({migrationLocks:result.rows}));
const pid=Number(process.argv.find(v=>v.startsWith('--release-idle='))?.split('=')[1]);
if(pid){
 const pending=await db.query('SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL');
 if(pending.rows[0].count)throw Error('An unfinished migration exists');
 const released=await db.query(`SELECT pg_terminate_backend(a.pid) AS released FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.pid=$1 AND a.state='idle' AND a.xact_start IS NULL AND a.usename=current_user AND a.datname=current_database() AND l.locktype='advisory' AND l.objid=72707369 AND l.granted`,[pid]);
 console.log(JSON.stringify({staleIdleMigrationConnectionReleased:released.rows.some(r=>r.released)}));
}}catch{console.error('Migration lock inspection failed');process.exitCode=1;}finally{await db.end();}
