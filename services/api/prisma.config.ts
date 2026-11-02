import {migrationDatabaseUrl} from './src/config.mjs';
import {defineConfig} from 'prisma/config';
export default defineConfig({
  schema:'prisma/schema.prisma',
  migrations:{path:'prisma/migrations'},
  datasource:{url:migrationDatabaseUrl(process.env.DATA_BASE_URL,process.env.DATA_BASE_DIRECT_URL)}
});
