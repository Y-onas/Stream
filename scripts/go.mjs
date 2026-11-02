import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const windows = process.platform === 'win32';
const localGo = path.join(root, '.tools/go/bin', windows ? 'go.exe' : 'go');
const binary = path.join(root, 'bin', windows ? 'stream-discover.exe' : 'stream-discover');
const [action, ...extra] = process.argv.slice(2);
const env = {...process.env};
if (existsSync(localGo)) {
  env.GOPATH = path.join(root, '.tools/gopath');
  env.GOCACHE = path.join(root, '.tools/gocache');
}
const args = action === 'build' ? ['build', '-o', binary, './cmd/stream-discover'] : action === 'test' ? ['test', '-p', '1', './...'] : extra;
if (!['run', 'build', 'test'].includes(action)) throw new Error('Expected run, build or test');
const child = spawn(action === 'run' ? binary : existsSync(localGo) ? localGo : 'go', args, {
  cwd: action === 'run' ? root : path.join(root, 'services/stream-go'), env, stdio: 'inherit'
});
child.on('error', () => { console.error('Cannot start Go command; install Go or build the executable first.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
