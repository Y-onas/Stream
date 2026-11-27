import './config.mjs';
import {PrismaClient,Prisma} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
export {Prisma};
export function createDatabase(connectionString=process.env.DATA_BASE_URL,{schema}={}){
  if(!connectionString)throw Error('DATA_BASE_URL is required');
  schema=schema||new URL(connectionString).searchParams.get('schema')||'public';
  if(!/^[a-z_][a-z0-9_]*$/.test(schema))throw Error('Invalid database schema');
  const max=Number(process.env.DATABASE_POOL_MAX||8);
  if(!Number.isInteger(max)||max<1||max>32)throw Error('DATABASE_POOL_MAX must be an integer between 1 and 32.');
  const adapter=new PrismaPg({connectionString,max,connectionTimeoutMillis:10000,idleTimeoutMillis:30000,query_timeout:10000,statement_timeout:8000,application_name:'habeshan-hub-api'},{schema});
  // A cold remote pool connection can exceed Prisma's two-second checkout
  // default. Keep a finite five-second acquisition bound; transaction/query
  // execution deadlines and the pool's connection ceiling remain independent.
  const db=new PrismaClient({adapter,log:[],transactionOptions:{maxWait:5000}});Object.defineProperty(db,'appSchema',{value:schema});return db;
}
