import {spawn} from 'node:child_process';
const child=spawn(process.execPath,['--test','--test-concurrency=1','tests/module41-database.test.mjs','tests/module42-database.test.mjs'],{
  stdio:'inherit',windowsHide:true,env:{...process.env,RUN_DB_TESTS:'1'}
});
child.on('error',()=>{process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
