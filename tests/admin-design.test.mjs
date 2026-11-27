import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';

test('real admin Vite configuration compiles its copied theme from repository root',async t=>{
  const root=path.resolve('apps/admin');
  const server=await createServer({root,configFile:path.join(root,'vite.config.mjs'),server:{middlewareMode:true,watch:null},appType:'custom',logLevel:'silent'});
  t.after(()=>server.close());
  const result=await server.transformRequest('/src/styles/main.css');
  assert.ok(result?.code);
  // Without these utilities the backdrop occupies the page and the real
  // authenticated dashboard is displaced, despite successful JSX rendering.
  for(const selector of ['.fixed','.flex','.h-screen','.z-20'])assert.ok(result.code.includes(selector),`Missing compiled utility: ${selector}`);
  assert.ok(result.code.includes('246, 155, 97'),'Reference accent is compiled');
  assert.ok(!result.code.includes('@tailwind '),'No unprocessed Tailwind directives');
});

// Exercise both transferred JSX branches: a production build alone does not
// catch an undefined component that only renders in the expanded sidebar.
test('transferred navigation renders both sizes with only supplied Hub routes',async t=>{
  const server=await createServer({configFile:false,root:path.resolve('apps/admin'),plugins:[react()],server:{middlewareMode:true,watch:null},appType:'custom',logLevel:'silent'});
  t.after(()=>server.close());
  const {default:Sidebar}=await server.ssrLoadModule('/src/design/Sidebar.jsx');
  const routes=[['/','Overview'],['/videos','Videos'],['/memberships','Memberships']];
  for(const collapsed of [false,true]){
    const markup=renderToStaticMarkup(React.createElement(Sidebar,{collapsed,setCollapsed(){},activePage:'/videos',setActivePage(){},admin:{name:'Fixture',email:'fixture@example.test'},routes,base:'/hub-console',onSignOut(){}}));
    assert.match(markup,/href="\/hub-console\/videos"[^>]*aria-current="page"/);
    assert.match(markup,/aria-label="Sign out"/);
    for(const [,name] of routes)assert.ok(markup.includes(name));
    assert.doesNotMatch(markup,/\/administrators|\/settings|Wonder Studio|Sorvo|mockData/);
  }
});

test('analytics sections retain the source metrics, rankings and complete time-series table',async t=>{
  const server=await createServer({configFile:false,root:path.resolve('apps/admin'),plugins:[react()],server:{middlewareMode:true,watch:null},appType:'custom',logLevel:'silent'});
  t.after(()=>server.close());
  const {AnalyticsReport}=await server.ssrLoadModule('/src/Analytics.jsx');
  const d={range:{timezone:'Africa/Nairobi'},users:{total:901,active:902,suspended:903,registrations:904},videos:{total:905,published:906,hidden:907,unavailable:908},views:{total:909,selected:910,vip:911,free:912,legacy:913,signedInViewers:914,today:915,week:916,month:917},memberships:{active:918,expired:919,activations:920,expirations:921},pendingRequests:922,approvedRequests:923,requests:{total:924,pending:925,approved:926,rejected:927,approvalRate:.5},series:[{date:'2026-11-01',views:928,registrations:929,activeUsers:930,activeMemberships:931,activations:932,expirations:933}],topVideos:[{id:'ranked',title:'Ranked fixture',views:934,durationSeconds:960}],trending:{day:[{id:'trend',title:'Trending fixture',views:935}]},longest:[{id:'longest',title:'Longest fixture',durationSeconds:7200}],packageDistribution:[{package:'Package fixture',active:936}]};
  const render=props=>renderToStaticMarkup(React.createElement(AnalyticsReport,{d,...props}));
  const combined=['viewing','audience','memberships','catalogue'].map(tab=>render({tab})).join('');
  for(let value=901;value<=936;value++)assert.ok(combined.includes(String(value)),`Missing source value ${value}`);
  for(const text of ['Ranked fixture','Trending fixture','Longest fixture','Package fixture','Analytics time series','Duration','Measured duration'])assert.ok(combined.includes(text),text);
  assert.doesNotMatch(combined,/Age distribution|Top countries|Device distribution|Portugal/);
  assert.match(render({overview:true}),/All platform totals/);
  const empty={...d,views:{...d.views,selected:0,vip:0,free:0,legacy:0},requests:{...d.requests,total:0,approvalRate:0},series:[],topVideos:[],longest:[],packageDistribution:[],trending:{day:[]}};
  for(const tab of ['viewing','audience','memberships','catalogue']){
    const markup=renderToStaticMarkup(React.createElement(AnalyticsReport,{d:empty,tab}));
    assert.doesNotMatch(markup,/NaN|Infinity/);
  }
});
