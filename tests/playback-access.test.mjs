import test from 'node:test';
import assert from 'node:assert/strict';
import {lacksVipMembership} from '../apps/web/src/services/playback-access.mjs';
const at=Date.parse('2026-11-04T12:00:00Z'),vip={accessType:'VIP'};
const member={status:'ACTIVE',expiresAt:new Date(at+3600000).toISOString()},account={loading:false,user:{id:'fixture'},membership:member};
test('known non-members never enter the VIP media initialization flow',()=>{
 for(const value of [{loading:false,user:null,membership:null},{...account,membership:null},{...account,membership:{...member,status:'EXPIRED'}},{...account,membership:{...member,expiresAt:new Date(at).toISOString()}},{...account,membership:{...member,revokedAt:new Date(at-1000).toISOString()}},{...account,membership:{...member,expiresAt:'invalid'}}])assert.equal(lacksVipMembership(value,vip,at),true);
});
test('active VIPs retain silent authorization; unknown accounts still wait for the server',()=>{
 assert.equal(lacksVipMembership(account,vip,at),false);assert.equal(lacksVipMembership({loading:true,user:null,membership:null},vip,at),false);
});
test('public Free videos remain available to guests and non-members',()=>{
 for(const value of [account,{loading:false,user:null,membership:null}])assert.equal(lacksVipMembership(value,{accessType:'FREE'},at),false);
});
