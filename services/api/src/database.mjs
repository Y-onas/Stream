import './config.mjs';
import {PrismaClient,Prisma} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
export {Prisma};
export function createDatabase(connectionString=process.env.DATA_BASE_URL,{schema}={}){
  if(!connectionString)throw Error('DATA_BASE_URL is required');
  schema=schema||new URL(connectionString).searchParams.get('schema')||'public';
  if(!/^[a-z_][a-z0-9_]*$/.test(schema))throw Error('Invalid database schema');
  const adapter=new PrismaPg({connectionString,max:Number(process.env.DATABASE_POOL_MAX||8),connectionTimeoutMillis:10000,idleTimeoutMillis:30000},{schema});
  const db=new PrismaClient({adapter,log:[]});Object.defineProperty(db,'appSchema',{value:schema});return db;
}
