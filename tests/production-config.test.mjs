import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {validateProductionEnvironment,ConfigurationError} from '../services/api/src/production-config.mjs';
import {migrationDatabaseUrl} from '../services/api/src/config.mjs';
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
function fixture(){return{env:{DATA_BASE_URL:'postgresql://fixture:fixture@db.example.test/hub?sslmode=verify-full',PUBLIC_ORIGIN:'https://hub.example.test',STREAM_ORIGIN:'http://stream-go:8080',STREAM_SERVICE_TOKEN:'stream-'+ 'a'.repeat(40),API_GATEWAY_TOKEN:'gateway-'+ 'b'.repeat(40),PLAYBACK_PRIVATE_KEY_PATH:'fixture-private.pem',PLAYBACK_PUBLIC_KEY_PATH:'fixture-public.pem'},config:{adminOrigin:'https://hub.example.test',clerkPublishableKey:'pk_live_fixture',clerkSecretKey:'sk_live_fixture',currency:'ETB',timezone:'Africa/Nairobi',sessionUpstreamLimit:2,playbackPrivateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}),playbackPublicKey:pair.publicKey.export({type:'spki',format:'pem'})}};}
test('production preflight validates secrets/origins/keys without contacting a database',()=>{const{env,config}=fixture();assert.deepEqual(validateProductionEnvironment(env,config),{valid:true,httpsRequired:true,migrationsAutomatic:false,clerkDevelopmentKeys:false});assert.equal(migrationDatabaseUrl(undefined,undefined),undefined);});
test('production preflight reports field names without echoing invalid values',async t=>{
 for(const [name,edit]of [
  ['DATA_BASE_URL',f=>delete f.env.DATA_BASE_URL],
  ['DATA_BASE_URL',f=>f.env.DATA_BASE_URL='secret-input'],
  ['DATA_BASE_URL',f=>f.env.DATA_BASE_URL='postgresql://fixture:secret-input@external.test/hub?sslmode=disable'],
  ['PUBLIC_ORIGIN',f=>f.env.PUBLIC_ORIGIN='http://secret-input.test'],
  ['ADMIN_ORIGIN',f=>f.config.adminOrigin='https://secret-input.test/path'],
  ['STREAM_ORIGIN',f=>f.env.STREAM_ORIGIN='http://user:secret-input@stream-go'],
  ['STREAM_SERVICE_TOKEN',f=>f.env.STREAM_SERVICE_TOKEN='secret-input'],
  ['API_GATEWAY_TOKEN',f=>f.env.API_GATEWAY_TOKEN=f.env.STREAM_SERVICE_TOKEN],
  ['CLERK_PUBLIC_KEY',f=>f.config.clerkPublishableKey='secret-input'],
  ['CLERK_PUBLIC_KEY',f=>f.config.clerkPublishableKey='pk_test_fixture'],
  ['CLERK_SECRET_KEY',f=>f.config.clerkSecretKey='secret-input'],
  ['CLERK_SECRET_KEY',f=>f.config.clerkSecretKey='sk_test_fixture'],
  ['API_PORT',f=>f.env.API_PORT='secret-input'],
  ['DATABASE_POOL_MAX',f=>f.env.DATABASE_POOL_MAX='secret-input'],
  ['PLAYBACK_SESSION_UPSTREAM_LIMIT',f=>f.config.sessionUpstreamLimit=0],
  ['APP_TIMEZONE',f=>f.config.timezone='secret-input'],
  ['MEMBERSHIP_CURRENCY',f=>f.config.currency='secret-input'],
  ['EMAIL',f=>f.config.bootstrapEmail='secret-input'],
  ['PLAYBACK_PRIVATE_KEY_PATH',f=>f.config.playbackPrivateKey='secret-input']
 ])await t.test(name,()=>{const f=fixture();edit(f);assert.throws(()=>validateProductionEnvironment(f.env,f.config),error=>error instanceof ConfigurationError&&error.message.includes(name)&&!error.message.includes('secret-input'));});
});
