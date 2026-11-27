import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';

// Test-only binary: production images build cmd/stream-service exclusively.
export function buildPlaybackFixture(){
 const root=path.resolve('.'),windows=process.platform==='win32',local=path.join(root,'.tools/go/bin',windows?'go.exe':'go'),binary=path.join(root,'.local/qa',windows?'playback-fixture.exe':'playback-fixture');
 mkdirSync(path.dirname(binary),{recursive:true});
 const env={...process.env,...(existsSync(local)?{GOPATH:path.join(root,'.tools/gopath'),GOCACHE:path.join(root,'.tools/gocache')}:{})};
 execFileSync(existsSync(local)?local:'go',['build','-o',binary,'./internal/playback/testserver'],{cwd:path.join(root,'services/stream-go'),env,windowsHide:true,timeout:120000,stdio:['ignore','ignore','pipe']});
 return binary;
}
