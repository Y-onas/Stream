import {generateKeyPairSync,createPublicKey} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const directory=new URL('../.local/',import.meta.url);mkdirSync(directory,{recursive:true});
const privatePath=new URL('playback-private.pem',directory),publicPath=new URL('playback-public.pem',directory);
if(!existsSync(privatePath)){
  if(existsSync(publicPath))throw Error('Public key already exists without its private key; restore the matching private key.');
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:3072});
  writeFileSync(privatePath,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600,flag:'wx'});
}
const publicKey=createPublicKey(readFileSync(privatePath)).export({type:'spki',format:'pem'});
if(existsSync(publicPath)){if(readFileSync(publicPath,'utf8')!==publicKey)throw Error('Playback key pair does not match.');}
else writeFileSync(publicPath,publicKey,{mode:0o644,flag:'wx'});
console.log('Local playback signing keys are ready. Existing keys and .env were preserved.');
