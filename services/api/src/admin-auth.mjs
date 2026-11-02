import {createClerkClient,verifyToken} from '@clerk/backend';
import {HttpError} from './domain.mjs';
export function createAdminAuth(config,{db,verify=verifyToken,getUser}={}){
  const clerk=config.clerkSecretKey?createClerkClient({secretKey:config.clerkSecretKey,publishableKey:config.clerkPublishableKey||undefined}):null;
  return async req=>{
    const bearer=/^Bearer (.+)$/.exec(req.headers.authorization||'');
    if(!bearer)throw new HttpError(401,'Sign in to the administrator application.');
    if((!config.clerkSecretKey&&!config.clerkJwtKey)||!db)throw new HttpError(503,'Administrator authentication is not configured.');
    let claims;try{claims=await verify(bearer[1],{secretKey:config.clerkSecretKey,jwtKey:config.clerkJwtKey,authorizedParties:[config.adminOrigin]});}catch{throw new HttpError(401,'Administrator session could not be verified.');}
    if(!claims.sub)throw new HttpError(401,'Administrator session could not be verified.');
    let user;try{user=await (getUser?getUser(claims.sub):clerk.users.getUser(claims.sub));}catch{throw new HttpError(503,'Administrator identity verification is unavailable.');}
    const verified=new Set((user.emailAddresses||[]).filter(e=>e.verification?.status==='verified').map(e=>e.emailAddress.toLowerCase()));
    const google=(user.externalAccounts||[]).find(a=>['google','oauth_google'].includes(a.provider)&&a.verification?.status==='verified'&&verified.has(a.emailAddress?.toLowerCase()));
    if(!google)throw new HttpError(403,'Use a verified Google account approved for administration.');
    const email=google.emailAddress.toLowerCase();let admin=await db.administrator.findUnique({where:{email}});
    if(!admin||admin.status!=='ACTIVE'||(admin.clerkUserId&&admin.clerkUserId!==claims.sub))throw new HttpError(403,'This Google account is not approved for administration.');
    if(!admin.clerkUserId){
      try{await db.$transaction(async tx=>{const result=await tx.administrator.updateMany({where:{id:admin.id,status:'ACTIVE',clerkUserId:null},data:{clerkUserId:claims.sub}});if(result.count)await tx.adminAuditLog.create({data:{adminId:admin.id,action:'ADMINISTRATOR_GOOGLE_CONNECTED',targetType:'Administrator',targetId:admin.id,after:{clerkUserId:claims.sub},note:'Verified approved Google identity linked on first sign-in.'}});});}catch{throw new HttpError(403,'Administrator identity could not be linked.');}
      admin=await db.administrator.findUnique({where:{email}});
      if(!admin||admin.status!=='ACTIVE'||admin.clerkUserId!==claims.sub)throw new HttpError(403,'This Google account is not approved for administration.');
    }
    return {id:admin.id,name:admin.name,email:admin.email,role:admin.role,clerkUserId:claims.sub};
  };
}
