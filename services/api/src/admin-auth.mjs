import {createClerkClient,verifyToken} from '@clerk/backend';
import {HttpError} from './domain.mjs';
export function createAdminAuth(config,{db,verify=verifyToken,getUser,getSession}={}){
  const clerk=config.clerkSecretKey?createClerkClient({secretKey:config.clerkSecretKey,publishableKey:config.clerkPublishableKey||undefined}):null;
  const denied=()=>new HttpError(403,'Administrator access is not permitted.','ADMIN_ACCESS_DENIED');
  const normalize=value=>typeof value==='string'?value.trim().toLowerCase():'';
  return async req=>{
    const bearer=/^Bearer (.+)$/.exec(req.headers.authorization||'');
    if(!bearer)throw new HttpError(401,'Sign in to the administrator application.');
    if((!config.clerkSecretKey&&!config.clerkJwtKey)||(!clerk&&(!getUser||!getSession))||!db||!config.adminOrigin)throw new HttpError(503,'Administrator authentication is not configured.');
    let claims;try{claims=await verify(bearer[1],{secretKey:config.clerkSecretKey,jwtKey:config.clerkJwtKey,authorizedParties:[config.adminOrigin]});}catch{throw new HttpError(401,'Administrator session could not be verified.');}
    if(typeof claims.sub!=='string'||!claims.sub||typeof claims.sid!=='string'||!claims.sid||claims.sts&&claims.sts!=='active')throw new HttpError(401,'Complete administrator sign-in.');
    let user,session;try{[user,session]=await Promise.all([getUser?getUser(claims.sub):clerk.users.getUser(claims.sub),getSession?getSession(claims.sid):clerk.sessions.getSession(claims.sid)]);}catch(error){if(error.status===404)throw new HttpError(401,'Administrator session could not be verified.');throw new HttpError(503,'Administrator identity verification is unavailable.');}
    // A signed token alone can outlive sign-out/revocation. Check Clerk's live
    // session too, and never authorize a pending setup/MFA session.
    if(!session||session.id!==claims.sid||session.userId!==claims.sub||session.status!=='active'||!Number.isFinite(session.expireAt)||session.expireAt<=Date.now())throw new HttpError(401,'Administrator session could not be verified.');
    if(claims.act||session.actor)throw denied();
    if(!user||user.id&&user.id!==claims.sub||user.banned||user.locked)throw denied();
    const verified=new Set((user.emailAddresses||[]).filter(e=>e.verification?.status==='verified').map(e=>normalize(e.emailAddress)).filter(Boolean));
    const google=(user.externalAccounts||[]).find(a=>['google','oauth_google'].includes(a.provider)&&a.verification?.status==='verified'&&verified.has(normalize(a.emailAddress)));
    if(!google)throw denied();
    // Stable Clerk identity wins after the one-time email approval/link. A
    // disabled linked record cannot fall back to a different approved email.
    const email=normalize(google.emailAddress);let admin=await db.administrator.findUnique({where:{clerkUserId:claims.sub}});
    if(!admin)admin=await db.administrator.findUnique({where:{email}});
    if(!admin||admin.status!=='ACTIVE'||!['OWNER','ADMIN'].includes(admin.role)||(admin.clerkUserId&&admin.clerkUserId!==claims.sub))throw denied();
    if(!admin.clerkUserId){
      try{await db.$transaction(async tx=>{const result=await tx.administrator.updateMany({where:{id:admin.id,status:'ACTIVE',clerkUserId:null},data:{clerkUserId:claims.sub}});if(result.count)await tx.adminAuditLog.create({data:{adminId:admin.id,action:'ADMINISTRATOR_GOOGLE_CONNECTED',targetType:'Administrator',targetId:admin.id,after:{clerkUserId:claims.sub},note:'Verified approved Google identity linked on first sign-in.'}});});}catch{throw denied();}
      admin=await db.administrator.findUnique({where:{clerkUserId:claims.sub}});
      if(!admin||admin.status!=='ACTIVE'||!['OWNER','ADMIN'].includes(admin.role))throw denied();
    }
    // Enforce an enrolled OWNER's second factor using signed Clerk claims.
    // Enrollment/configuration is owned by Clerk, never a browser role flag.
    if(admin.role==='OWNER'&&user.twoFactorEnabled&&(!Array.isArray(claims.fva)||!Number.isFinite(claims.fva[1])||claims.fva[1]<0))throw new HttpError(403,'Complete two-step verification and sign in again.','ADMIN_MFA_REQUIRED');
    return {id:admin.id,name:admin.name,email:admin.email,role:admin.role,clerkUserId:claims.sub,mfaEnabled:!!user.twoFactorEnabled};
  };
}
