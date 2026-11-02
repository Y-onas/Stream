import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {SignJWT,importPKCS8} from 'jose';
import {createPlaybackGrants} from '../services/api/src/playback-grants.mjs';

const pair=generateKeyPairSync('rsa',{modulusLength:2048}),config={playbackPrivateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}),playbackPublicKey:pair.publicKey.export({type:'spki',format:'pem'}),playbackTTL:300},at=new Date('2026-11-02T12:00:00Z');
const claims=()=>({purpose:'playback',vid:randomUUID(),sid:randomUUID(),ctx:randomUUID(),mode:'VIP',sub:randomUUID()});
test('RS256 grants bind exact registered and playback claims',async()=>{
 const service=createPlaybackGrants(config,()=>at),payload=claims(),token=await service.sign(payload,new Date(+at+300000)),verified=await service.verify(token);
 for(const [key,value]of Object.entries(payload))assert.equal(verified[key],value);
 assert.equal(verified.exp-verified.iat,300);assert.equal(verified.iss,'habeshan-hub');assert.equal(verified.aud,'habeshan-stream');assert.ok(verified.jti);
 await assert.rejects(service.verify(token.slice(0,-5)+'bad!!'),e=>e.status===401);
 assert.throws(()=>createPlaybackGrants({...config,playbackPublicKey:generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'pem'})},()=>at),/mismatched playback signing keys/);
});
test('expired grants cannot start requests; private active introspection can verify their signature',async()=>{
 let clock=at;const service=createPlaybackGrants(config,()=>clock),token=await service.sign(claims(),new Date(+at+30000));clock=new Date(+at+31000);
 await assert.rejects(service.verify(token),e=>e.status===401);assert.equal((await service.verify(token,{active:true})).purpose,'playback');
 await assert.rejects(service.verify(token.slice(0,-6)+'broken',{active:true}),e=>e.status===401);
});
test('wrong issuer, audience, type, access mode and missing required claims are rejected',async()=>{
 const service=createPlaybackGrants(config,()=>at),key=await importPKCS8(config.playbackPrivateKey,'RS256');
 for(const changes of [{iss:'other'},{aud:'other'},{exp:undefined},{jti:undefined},{sid:undefined},{mode:'PUBLIC'},{purpose:'unknown'}]){
  const payload={...claims(),iss:'habeshan-hub',aud:'habeshan-stream',iat:+at/1000,exp:+at/1000+300,jti:randomUUID(),...changes};
  const token=await new SignJWT(payload).setProtectedHeader({alg:'RS256',typ:'JWT'}).sign(key);
  await assert.rejects(service.verify(token),e=>e.status===401);
 }
});
test('missing signing configuration fails closed',async()=>{
 const service=createPlaybackGrants({},()=>at);assert.equal(service.configured,false);
 await assert.rejects(service.sign(claims(),new Date(+at+300000)),e=>e.status===503);
});
