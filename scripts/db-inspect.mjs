import '../services/api/src/config.mjs';
import pg from 'pg';
import {mkdir,writeFile} from 'node:fs/promises';
const connectionString=process.env.DATA_BASE_URL;
if(!connectionString){console.log(JSON.stringify({databaseConfigured:false}));process.exit(1);}
const client=new pg.Client({connectionString,connectionTimeoutMillis:10000,statement_timeout:10000});
try{
  await client.connect();await client.query('BEGIN READ ONLY');
  const tables=await client.query("SELECT table_schema,table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema,table_name,ordinal_position");
  const constraints=await client.query("SELECT n.nspname AS schema,c.relname AS table_name,con.conname AS name,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')");
  await client.query('ROLLBACK');
  const report={connected:true,columns:tables.rows,constraints:constraints.rows};
  await mkdir(new URL('../.local/',import.meta.url),{recursive:true});
  await writeFile(new URL('../.local/database-inspection.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify({connected:true,tables:[...new Set(tables.rows.map(r=>`${r.table_schema}.${r.table_name}`))],columnCount:tables.rowCount,report:'.local/database-inspection.json'}));
}catch(error){console.log(JSON.stringify({connected:false,code:error.code||'CONNECTION_FAILED',message:'Database inspection failed; credentials and connection URL were not printed.'}));process.exitCode=1;}
finally{await client.end().catch(()=>{});}
