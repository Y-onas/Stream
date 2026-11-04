import {migrationDatabaseUrl} from './src/config.mjs';
import {defineConfig} from 'prisma/config';
const databaseURL=migrationDatabaseUrl(process.env.DATA_BASE_URL,process.env.DATA_BASE_DIRECT_URL);
export default defineConfig({
  schema:'prisma/schema.prisma',
  migrations:{path:'prisma/migrations'},
  // Generation needs no database; migration commands require DATA_BASE_URL.
  ...(databaseURL?{datasource:{url:databaseURL}}:{})
});
