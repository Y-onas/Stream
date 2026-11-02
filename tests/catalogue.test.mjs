import test from 'node:test';
import assert from 'node:assert/strict';
import {filterVideos} from '../apps/web/src/utils/catalogue.mjs';
import {publicVideo} from '../apps/web/dev/adapter.mjs';
const videos=[{id:'a',title:'Trip',filename:'trip.MOV',uploadedAt:'2026-01-01',durationSeconds:10},{id:'b',title:'Garden',filename:'garden.webm',uploadedAt:'2026-02-01',durationSeconds:20},{id:'c',title:'Recording',filename:'recording.mkv',uploadedAt:'2026-03-01',durationSeconds:null}];
test('search and actual chronological/duration sorts',()=>{
  assert.deepEqual(filterVideos(videos,'','all','latest').map(x=>x.id),['c','b','a']);
  assert.deepEqual(filterVideos(videos,'','all','oldest').map(x=>x.id),['a','b','c']);
  assert.deepEqual(filterVideos(videos,'','all','longest').map(x=>x.id),['b','a','c']);
  assert.equal(filterVideos(videos,'TRIP','mov')[0].id,'a');assert.equal(filterVideos(videos,'missing').length,0);
  assert.equal(filterVideos(videos,'','all','most-viewed'),null);
});
test('public metadata excludes private mapping and unknown data stays unknown',()=>{
  const value=publicVideo({...videos[0],messageId:3,accessHash:'private',internalPort:8080});
  assert.equal(value.messageId,undefined);assert.equal(value.accessHash,undefined);assert.equal(value.internalPort,undefined);assert.equal(publicVideo(videos[2]).durationSeconds,null);
});
