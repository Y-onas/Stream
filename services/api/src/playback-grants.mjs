import {readFileSync,existsSync} from 'node:fs';
import {randomUUID,createPrivateKey,createPublicKey} from 'node:crypto';
import {SignJWT,jwtVerify,compactVerify,importPKCS8,importSPKI} from 'jose';
import {HttpError,isUUID} from './domain.mjs';

export function createPlaybackGrants(config,now=()=>new Date()){
  const ttl=config.playbackTTL??300,issuer=config.playbackIssuer||'habeshan-hub',audience=config.playbackAudience||'habeshan-stream';
  if(!Number.isInteger(ttl)||ttl<30||ttl>600)throw Error('Playback grant lifetime must be 30–600 seconds.');
  const privatePEM=config.playbackPrivateKey||((config.playbackPrivateKeyPath&&existsSync(config.playbackPrivateKeyPath))?readFileSync(config.playbackPrivateKeyPath,'utf8'):null);
  const publicPEM=config.playbackPublicKey||((config.playbackPublicKeyPath&&existsSync(config.playbackPublicKeyPath))?readFileSync(config.playbackPublicKeyPath,'utf8'):null);
  let privateKey,publicKey;
  const configured=!!privatePEM&&!!publicPEM;
  if(configured){try{const privateObject=createPrivateKey(privatePEM),publicObject=createPublicKey(publicPEM);if(privateObject.asymmetricKeyType!=='rsa'||(privateObject.asymmetricKeyDetails?.modulusLength||0)<2048||!createPublicKey(privateObject).export({type:'spki',format:'der'}).equals(publicObject.export({type:'spki',format:'der'})))throw Error();}catch{throw Error('Invalid or mismatched playback signing keys.');}}
  async function keys(){if(!configured)throw new HttpError(503,'Playback authorization is not configured.');privateKey??=importPKCS8(privatePEM,'RS256');publicKey??=importSPKI(publicPEM,'RS256');return{privateKey:await privateKey,publicKey:await publicKey};}
  function claimsValid(c,{active=false}={}){
    const time=Math.floor(+now()/1000);
    if(c.iss!==issuer||c.aud!==audience||!isUUID(c.vid)||!isUUID(c.jti)||!Number.isInteger(c.iat)||!Number.isInteger(c.exp)||c.iat>time+2||c.exp<=c.iat||c.exp-c.iat>ttl||(!active&&c.exp<=time)||!['playback','probe'].includes(c.purpose))throw Error('Invalid grant claims');
    if(c.purpose==='playback'&&(!isUUID(c.sid)||!isUUID(c.ctx)||!['VIP','FREE'].includes(c.mode)||typeof c.sub!=='string'||!c.sub))throw Error('Invalid playback claims');
    if(c.purpose==='probe'&&(c.mode!=='INTERNAL'||c.sub!=='media-worker'))throw Error('Invalid worker claims');
    return c;
  }
  return{configured,ttl,
    async sign(claims,until){const {privateKey}=await keys(),iat=Math.floor(+now()/1000),exp=Math.floor(+until/1000);if(exp<=iat)throw new HttpError(403,'Playback access has expired.','ACCESS_EXPIRED');return new SignJWT(claims).setProtectedHeader({alg:'RS256',typ:'JWT'}).setIssuer(issuer).setAudience(audience).setIssuedAt(iat).setExpirationTime(exp).setJti(randomUUID()).sign(privateKey);},
    async verify(value,{active=false}={}){
      try{
        if(typeof value!=='string'||value.length>8192)throw Error('Missing grant');
        const {publicKey}=await keys();let payload;
        // An already-open stream is governed by its renewed database lease. Only
        // this private introspection path may inspect an expired signed grant.
        if(active){const verified=await compactVerify(value,publicKey,{algorithms:['RS256']});if(verified.protectedHeader.typ!=='JWT')throw Error('Invalid type');payload=JSON.parse(new TextDecoder().decode(verified.payload));}
        else{const verified=await jwtVerify(value,publicKey,{algorithms:['RS256'],issuer,audience,typ:'JWT',currentDate:now(),requiredClaims:['iss','aud','iat','exp','jti','vid','purpose','mode','sub']});payload=verified.payload;}
        return claimsValid(payload,{active});
      }catch(error){if(error.status===503)throw error;throw new HttpError(401,'Playback authorization is missing, invalid or expired.','PLAYBACK_GRANT_INVALID');}
    }
  };
}
