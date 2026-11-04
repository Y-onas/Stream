import {applicationConfig} from '../services/api/src/config.mjs';
import {validateProductionEnvironment,ConfigurationError} from '../services/api/src/production-config.mjs';
const {start}=await import('../services/api/src/server.mjs');
// Migrations are an explicit, one-off operator step. Replicas never run DDL or
// administrator/package bootstrap merely because their process starts.
try{if(process.env.NODE_ENV!=='production')throw new ConfigurationError('NODE_ENV must be production for this entrypoint.');const result=validateProductionEnvironment(process.env,applicationConfig());if(process.argv.includes('--check-config'))console.log(JSON.stringify({event:'api_configuration_valid',...result}));else start();}catch(error){console.error(JSON.stringify({event:'api_configuration_error',message:error instanceof ConfigurationError?error.message:'Check server configuration and private key permissions.'}));process.exitCode=1;}
