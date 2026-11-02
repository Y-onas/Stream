import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Prisma} from './database.mjs';
import {HttpError,hash,token,userDTO,videoDTO,username,password,hashPassword,verifyPassword,addMonths,supportContact,publicRequest,body,cookies,cookie,send,pager,cursorPage,isUUID} from './domain.mjs';
import {createAdminAuth} from './admin-auth.mjs';
import {createSettings,publicSettings} from './settings.mjs';
import {createAdministration,publicVideoWhere} from './administration.mjs';
import {createPlayback} from './playback.mjs';

const SESSION='hh_session',VIEWER='hh_viewer';
const safeEqual=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const validPosition=n=>Number.isFinite(n)&&n>=0&&n<=7*86400;
const jsonValue=v=>JSON.parse(JSON.stringify(v));
const publicMembership=m=>m?{id:m.id,planName:m.planName,activatedAt:m.activatedAt,expiresAt:m.expiresAt,revokedAt:m.revokedAt,status:m.revokedAt?'REVOKED':m.expiresAt<=new Date()?'EXPIRED':'ACTIVE'}:null;
export function createApplication({db,config,production=false,now=()=>new Date(),adminAuth=createAdminAuth(config,{db})}){
  let contact=supportContact(config.supportUsername);const limits=new Map(),salt=token(),settings=createSettings(db,config);
  const administration=createAdministration({db,config,settings,audit,now});
  new Intl.DateTimeFormat('en',{timeZone:config.timezone}).format(now());
  const snapshot=()=>now();
  const playbackAuth=createPlayback({db,config,production,actor,viewer,settings,now});
  let syncState=null;
  const table=name=>Prisma.raw(`"${db.appSchema||'public'}"."${name}"`);
  function limit(req,name,count,window){
    const key=hash(`${salt}|${req.headers['x-client-ip']||req.socket.remoteAddress}|${name}`),time=+snapshot();
    let item=limits.get(key);if(!item||item.end<=time){item={count:0,end:time+window};limits.set(key,item);}if(++item.count>count)throw new HttpError(429,'Too many attempts. Please try again later.');
    if(limits.size>5000)for(const [key,item] of limits){if(item.end<=time)limits.delete(key);if(limits.size<=5000)break;}
    if(limits.size>10000)throw new HttpError(429,'Please try again later.');
  }
  async function actor(req,res,{required=false,csrf=false}={}){
    const raw=cookies(req)[SESSION];let session;
    if(raw&&/^[a-f0-9]{64}$/.test(raw))session=await db.userSession.findUnique({where:{tokenHash:hash(raw)},include:{user:true}});
    if(!session||session.expiresAt<=snapshot()||session.user.status!=='ACTIVE'){
      if(raw)cookie(res,SESSION,'',{production,age:0});if(required)throw new HttpError(401,'Please sign in to continue.');return null;
    }
    if(csrf&&!safeEqual(req.headers['x-csrf-token'],session.csrfToken))throw new HttpError(403,'Please refresh your session and try again.');
    return session;
  }
  async function newSession(res,user){const value=token(),csrfToken=token();await db.userSession.create({data:{userId:user.id,tokenHash:hash(value),csrfToken,expiresAt:new Date(+snapshot()+30*86400000)}});cookie(res,SESSION,value,{production});return {user:userDTO(user),csrfToken};}
  async function viewer(req,res,{create=false}={}){
    const raw=cookies(req)[VIEWER];let session;
    if(raw&&/^[a-f0-9]{64}$/.test(raw))session=await db.viewerSession.findUnique({where:{tokenHash:hash(raw)}});
    if(session&&session.expiresAt>snapshot())return session;
    if(!create)throw new HttpError(401,'Playback session expired. Start playback again.');
    const value=token();session=await db.viewerSession.create({data:{tokenHash:hash(value),expiresAt:new Date(+snapshot()+30*86400000)}});cookie(res,VIEWER,value,{production});return session;
  }
  async function membership(userId){return db.membership.findFirst({where:{userId,revokedAt:null,expiresAt:{gt:snapshot()}},orderBy:{expiresAt:'desc'}});}
  async function audit(tx,admin,action,targetType,targetId,before,after,extra={}){await tx.adminAuditLog.create({data:{adminId:admin.id,action,targetType,targetId,...extra,...(before?{before:jsonValue(before)}:{}),...(after?{after:jsonValue(after)}:{})}});}
  async function catalogue(url,owned={}){
    const sort=url.searchParams.get('sort')||'latest',q=(url.searchParams.get('q')||'').trim();if(!['latest','oldest','most-viewed','longest'].includes(sort)||q.length>100)throw new HttpError(400,'Invalid catalogue query.');
    const {take,skip}=cursorPage(url),ids=url.searchParams.get('ids')?.split(',');if(ids&&(ids.length>100||ids.some(id=>!isUUID(id))))throw new HttpError(400,'Invalid video IDs.');
    const accessType=url.searchParams.get('access');if(accessType&&!['VIP','FREE'].includes(accessType))throw new HttpError(400,'Invalid access classification.');
    const where={...publicVideoWhere,...owned,...(accessType?{accessType}:{}),...(q?{OR:[{titleOverride:{contains:q,mode:'insensitive'}},{title:{contains:q,mode:'insensitive'}},{filename:{contains:q,mode:'insensitive'}}]}:{}),...(ids?{publicId:{in:ids}}:{})};
    const orderBy=sort==='most-viewed'?[{views:{_count:'desc'}},{uploadedAt:'desc'},{id:'asc'}]:sort==='longest'?[{durationSeconds:{sort:'desc',nulls:'last'}},{uploadedAt:'desc'},{id:'asc'}]:[{uploadedAt:sort==='oldest'?'asc':'desc'},{id:'asc'}];
    const [rows,total]=await Promise.all([db.video.findMany({where,orderBy,take,skip}),db.video.count({where})]);
    const nextCursor=skip+rows.length<total?Buffer.from(JSON.stringify({offset:skip+rows.length,sort,q:url.searchParams.get('q')||''})).toString('base64url'):null;
    return {items:rows.map(videoDTO),total,nextCursor,source:'postgresql',sync:syncState?.source||null,capabilities:{viewRanking:true,durationSorting:true,comments:true}};
  }
  async function trending(period){
    if(!['day','week','month'].includes(period))throw new HttpError(400,'Invalid period.');
    const {timezone}=await settings.get();
    const rows=await db.$queryRaw`SELECT v."videoId",count(*) AS views FROM ${table('hh_video_views')} v JOIN ${table('hh_videos')} m ON m.id=v."videoId" WHERE m.published AND m.available AND NOT m."adminUnavailable" AND m."accessType"='VIP' AND v."accessType"='VIP' AND v."qualifiedAt">=(date_trunc(${period}, ${snapshot()}::timestamptz AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone}) GROUP BY "videoId" ORDER BY views DESC,"videoId" ASC LIMIT 24`;
    const records=await db.video.findMany({where:{id:{in:rows.map(r=>r.videoId)},...publicVideoWhere}}),map=new Map(records.map(v=>[v.id,v]));return {available:true,period,items:rows.flatMap(r=>map.has(r.videoId)?[videoDTO(map.get(r.videoId))]:[])};
  }
  async function newRequest(user,planId,videoId){
    // Optional return navigation must not block membership requests when a
    // video is hidden, removed or the link contains an unusable public ID.
    if(videoId!==undefined&&videoId!==null&&(!isUUID(videoId)||!await db.video.findFirst({where:{publicId:videoId,...publicVideoWhere},select:{id:true}})))videoId=undefined;
    if(typeof planId!=='string')throw new HttpError(400,'Select a membership package.');
    const existing=await db.subscriptionRequest.findFirst({where:{userId:user.id,planId,status:'PENDING'}});if(existing){if(videoId&&existing.intendedVideoPublicId!==videoId)return db.subscriptionRequest.update({where:{id:existing.id},data:{intendedVideoPublicId:videoId,version:{increment:1}}});return existing;}
    const plan=await db.membershipPlan.findFirst({where:{id:planId,active:true}});if(!plan)throw new HttpError(400,'This package is not available.');
    for(let attempt=0;attempt<3;attempt++)try{return await db.subscriptionRequest.create({data:{reference:`HH-${randomBytes(8).toString('hex').toUpperCase()}`,userId:user.id,usernameSnapshot:user.username,intendedVideoPublicId:videoId||null,planId:plan.id,planNameSnapshot:plan.name,durationMonthsSnapshot:plan.durationMonths,amountMinorSnapshot:plan.priceMinor,currencySnapshot:plan.currency}});}catch(error){if(error.code!=='P2002')throw error;const pending=await db.subscriptionRequest.findFirst({where:{userId:user.id,planId,status:'PENDING'}});if(pending)return pending;}
    throw new HttpError(409,'Request could not be created. Please retry.');
  }
  async function processRequest(id,data,admin){
    if(!isUUID(id)||!['approve','reject','verify','note'].includes(data.action)||!Number.isInteger(data.version))throw new HttpError(400,'Invalid request operation.');
    const note=typeof data.note==='string'?data.note.trim():'';if(note.length>4000)throw new HttpError(400,'Note is too long.');
    const target=await db.subscriptionRequest.findUnique({where:{id},select:{userId:true}});if(!target)throw new HttpError(404,'Subscription request not found.');
    return db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM ${table('hh_users')} WHERE id=${target.userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM ${table('hh_subscription_requests')} WHERE id=${id}::uuid FOR UPDATE`;
      const request=await tx.subscriptionRequest.findUnique({where:{id},include:{membership:true}});if(!request)throw new HttpError(404,'Subscription request not found.');
      if(data.action==='approve'&&request.status==='APPROVED')return {request,membership:request.membership,alreadyApproved:true};
      if(request.version!==data.version)throw new HttpError(409,'This request changed. Refresh before processing it.');
      if(request.status!=='PENDING'&&data.action!=='note')throw new HttpError(409,'This request has already been processed.');
      if(['approve','verify'].includes(data.action)&&data.manualPaymentConfirmed!==true)throw new HttpError(400,'Confirm your manual review of the Telegram payment proof.');
      if(['reject','note'].includes(data.action)&&!note)throw new HttpError(400,'Enter an internal note.');
      const user=await tx.user.findUnique({where:{id:request.userId}});if(data.action==='approve'&&await tx.membership.findFirst({where:{userId:request.userId,revokedAt:null,expiresAt:{gt:snapshot()}}}))throw new HttpError(409,'This user already has an active membership. Use membership management to extend it or change its package.');if(data.action==='approve'&&user.status!=='ACTIVE')throw new HttpError(409,'Restore the suspended account before approving membership.');
      const at=snapshot(),change={version:{increment:1},...(note?{internalNote:note}:{}),...(data.action==='approve'?{status:'APPROVED',verificationStatus:'VERIFIED',processedByAdminId:admin.id,processedAt:at}:data.action==='reject'?{status:'REJECTED',verificationStatus:'REJECTED',processedByAdminId:admin.id,processedAt:at}:data.action==='verify'?{verificationStatus:'VERIFIED'}:{})};
      const updated=await tx.subscriptionRequest.update({where:{id},data:change});let activated;
      if(data.action==='approve'){
        activated=await tx.membership.create({data:{requestId:id,userId:request.userId,planId:request.planId,planName:request.planNameSnapshot,durationMonths:request.durationMonthsSnapshot,amountMinor:request.amountMinorSnapshot,currency:request.currencySnapshot,activatedAt:at,expiresAt:addMonths(at,request.durationMonthsSnapshot),approvedByAdminId:admin.id}});
        await audit(tx,admin,'MEMBERSHIP_ACTIVATED','Membership',activated.id,null,activated,{userId:request.userId,requestId:id,note});
      }
      await audit(tx,admin,{approve:'SUBSCRIPTION_APPROVED',reject:'SUBSCRIPTION_REJECTED',verify:'PAYMENT_MANUALLY_VERIFIED',note:'SUBSCRIPTION_NOTE_ADDED'}[data.action],'SubscriptionRequest',id,{status:request.status,verificationStatus:request.verificationStatus,internalNote:request.internalNote},{status:updated.status,verificationStatus:updated.verificationStatus,internalNote:updated.internalNote},{userId:request.userId,requestId:id,note});
      return {request:updated,membership:activated||null};
    },{timeout:15000});
  }
  async function heartbeat(req,res,id,data){
    if(!isUUID(id)||!validPosition(data.position)||!Number.isInteger(data.sequence)||data.sequence<1||typeof data.playing!=='boolean'||typeof data.seeking!=='boolean')throw new HttpError(400,'Invalid playback update.');
    const owner=await viewer(req,res);
    return db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM ${table('hh_playback_sessions')} WHERE id=${id}::uuid FOR UPDATE`;
      const play=await tx.playbackSession.findUnique({where:{id},include:{video:true}}),at=snapshot();
      if(play&&(!play.video.published||!play.video.available||play.video.adminUnavailable))throw new HttpError(404,'Video is not available.');
      if(!play||play.viewerId!==owner.id||play.expiresAt<=at||play.revokedAt||!play.authorizedUntil||play.authorizedUntil<=at)throw new HttpError(404,'Playback session not found or expired.');
      if(play.accessType!==play.video.accessType)throw new HttpError(403,'Playback access changed. Start playback again.');
      if(play.accessType==='VIP'){const session=await actor(req,res,{required:true,csrf:true});if(session.id!==play.accountSessionId)throw new HttpError(403,'Playback session does not belong to this account.');}
      await playbackAuth.policy(play.video,play.accountSessionId);
      if(data.sequence<=play.sequence)return {accepted:false,qualified:!!play.qualifiedAt};
      if(data.sequence!==play.sequence+1)throw new HttpError(409,'Restart the playback statistics session.');
      if(play.video.durationSeconds&&data.position>play.video.durationSeconds+2)throw new HttpError(400,'Invalid playback position.');
      const elapsed=(at-play.lastHeartbeatAt)/1000,advance=data.position-play.lastPosition;
      const credit=data.playing&&!data.seeking&&elapsed>0&&elapsed<=20&&advance>0&&advance<=elapsed*2.5+1?Math.min(10,elapsed,advance):0;
      const watched=play.watchedSeconds+credit,threshold=play.video.durationSeconds?Math.min(30,Math.max(1,play.video.durationSeconds/2)):30;
      let qualified=play.qualifiedAt,inserted=false;
      if(!qualified&&watched>=threshold){
        if(play.userId)await tx.watchedVideo.upsert({where:{userId_videoId:{userId:play.userId,videoId:play.videoId}},create:{userId:play.userId,videoId:play.videoId,firstWatchedAt:at,lastWatchedAt:at},update:{lastWatchedAt:at}});
        const bucket=Math.floor(+at/86400000),result=await tx.videoView.createMany({data:[{videoId:play.videoId,viewerId:owner.id,userId:play.userId,accessType:play.accessType,dedupeKey:hash(`${play.videoId}|${owner.id}|${bucket}`),userDedupeKey:play.userId?hash(`${play.videoId}|${play.userId}|${bucket}`):null,watchedSeconds:watched,qualifiedAt:at}],skipDuplicates:true});
        qualified=at;inserted=result.count===1;
      }
      await tx.playbackSession.update({where:{id},data:{sequence:data.sequence,lastHeartbeatAt:at,lastPosition:data.position,watchedSeconds:watched,qualifiedAt:qualified}});
      return {accepted:true,qualified:!!qualified,counted:inserted};
    },{timeout:10000});
  }
  async function overview(){
    const {timezone}=await settings.get();
    const [users,videos,qualifiedViews,activeMemberships,pendingRequests,periods]=await Promise.all([db.user.count(),db.video.count({where:{available:true}}),db.videoView.count(),db.membership.count({where:{revokedAt:null,expiresAt:{gt:snapshot()}}}),db.subscriptionRequest.count({where:{status:'PENDING'}}),db.$queryRaw`SELECT count(*) FILTER (WHERE "qualifiedAt">=(date_trunc('day',${snapshot()}::timestamptz AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone})) AS today,count(*) FILTER (WHERE "qualifiedAt">=(date_trunc('week',${snapshot()}::timestamptz AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone})) AS week,count(*) FILTER (WHERE "qualifiedAt">=(date_trunc('month',${snapshot()}::timestamptz AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone})) AS month FROM ${table('hh_video_views')}`]);
    return {registeredUsers:users,videos,qualifiedViews,viewsToday:Number(periods[0].today),viewsThisWeek:Number(periods[0].week),viewsThisMonth:Number(periods[0].month),activeMemberships,pendingRequests,timezone};
  }
  async function authorizeMedia(req,res,id){
    const platform=await settings.get();if(platform.maintenanceMode)throw new HttpError(503,platform.maintenanceMessage,'MAINTENANCE');
    if(!isUUID(id))throw new HttpError(404,'Video not found.');
    const video=await db.video.findFirst({where:{publicId:id,...publicVideoWhere}});if(!video)throw new HttpError(404,'Video not found.');
    return video;
  }
  async function handle(req,res,url){
    const path=url.pathname,method=req.method,isGet=method==='GET';
    if(path==='/api/admin/config'&&isGet){send(res,200,{publishableKey:config.clerkPublishableKey,configured:!!config.clerkPublishableKey&&!!config.clerkSecretKey,provider:'google'});return true;}
    if(!path.startsWith('/api/admin/')){const platform=await settings.get();contact=platform.supportUsername||null;if(path==='/api/config'&&isGet){send(res,200,publicSettings(platform));return true;}if(platform.maintenanceMode&&!['/api/auth/me','/api/auth/login','/api/auth/logout'].includes(path))throw new HttpError(503,platform.maintenanceMessage,'MAINTENANCE');}
    if(path==='/api/videos'&&isGet){send(res,200,await catalogue(url));return true;}
    if(path==='/api/trending'&&isGet){send(res,200,await trending(url.searchParams.get('period')||'day'));return true;}
    if(path==='/api/playback/authorize'&&method==='POST'){limit(req,'playback-start',40,60000);const data=await body(req);send(res,201,await playbackAuth.authorize(req,res,data.videoId,data.position??0));return true;}
    const grantAction=/^\/api\/playback\/([\w-]+)\/(renew|terminate)$/.exec(path);
    if(grantAction&&method==='POST'){limit(req,'playback-renew',60,60000);await body(req);send(res,200,await playbackAuth[grantAction[2]](req,res,grantAction[1]));return true;}
    const meta=/^\/api\/videos\/([\w-]+)$/.exec(path);if(meta&&isGet){if(!isUUID(meta[1]))throw new HttpError(404,'Video not found.');const video=await db.video.findFirst({where:{publicId:meta[1],...publicVideoWhere}});if(!video)throw new HttpError(404,'Video not found.');send(res,200,videoDTO(video));return true;}
    const commentVideo=/^\/api\/videos\/([\w-]+)\/comments$/.exec(path);
    if(commentVideo){
      if(!isUUID(commentVideo[1]))throw new HttpError(404,'Video not found.');const video=await db.video.findFirst({where:{publicId:commentVideo[1],...publicVideoWhere},select:{id:true}});if(!video)throw new HttpError(404,'Video not found.');
      if(isGet){const {take,skip}=pager(url),where={videoId:video.id,status:'PUBLISHED'};const [rows,total]=await Promise.all([db.comment.findMany({where,take,skip,orderBy:[{createdAt:'desc'},{id:'asc'}],include:{user:{select:{id:true,username:true,displayName:true}}}}),db.comment.count({where})]);send(res,200,{available:true,items:rows.map(c=>({id:c.id,body:c.body,createdAt:c.createdAt,author:{id:c.user.id,displayName:c.user.displayName||c.user.username}})),total,nextOffset:skip+rows.length<total?skip+rows.length:null});return true;}
      if(method==='POST'){limit(req,'comments',12,60000);const session=await actor(req,res,{required:true,csrf:true}),data=await body(req);if(typeof data.body!=='string'||!data.body.trim()||data.body.trim().length>2000)throw new HttpError(400,'Write a comment of 1–2,000 characters.');const c=await db.comment.create({data:{videoId:video.id,userId:session.userId,body:data.body.trim()}});send(res,201,{id:c.id,body:c.body,createdAt:c.createdAt,author:{id:session.userId,displayName:session.user.displayName||session.user.username}});return true;}
    }
    if(path==='/api/plans'&&isGet){send(res,200,{items:await db.membershipPlan.findMany({where:{active:true},orderBy:{sortOrder:'asc'}})});return true;}
    if(path==='/api/auth/username'&&isGet){limit(req,'availability',40,60000);const input=username(url.searchParams.get('username'));send(res,200,{username:input.username,available:!(await db.user.findUnique({where:{usernameCanonical:input.usernameCanonical},select:{id:true}}))});return true;}
    if(path==='/api/auth/me'&&isGet){const session=await actor(req,res);send(res,200,session?{user:userDTO(session.user),csrfToken:session.csrfToken,membership:publicMembership(await membership(session.userId))}:{user:null,csrfToken:null,membership:null});return true;}
    if(path==='/api/me/profile'&&method==='POST'){
      const session=await actor(req,res,{required:true,csrf:true}),data=await body(req);
      if(typeof data.displayName!=='string'||data.displayName.trim().length>50||/[\u0000-\u001f\u007f]/.test(data.displayName))throw new HttpError(400,'Use a display name of up to 50 characters.');
      const user=await db.user.update({where:{id:session.userId},data:{displayName:data.displayName.trim()||null}});send(res,200,{user:userDTO(user)});return true;
    }
    if(path==='/api/me/library'&&isGet){
      const session=await actor(req,res,{required:true}),userId=session.userId;
      const [likes,saved,watched,current]=await Promise.all([db.videoLike.findMany({where:{userId},select:{video:{select:{publicId:true}}}}),db.savedVideo.findMany({where:{userId},select:{video:{select:{publicId:true}}}}),db.watchedVideo.count({where:{userId}}),membership(userId)]);
      send(res,200,{userId,likedIds:likes.map(v=>v.video.publicId),savedIds:saved.map(v=>v.video.publicId),counts:{liked:likes.length,saved:saved.length,watched},membership:publicMembership(current)});return true;
    }
    if(path==='/api/me/videos'&&isGet){
      const session=await actor(req,res,{required:true}),kind=url.searchParams.get('kind');
      if(!['liked','saved','watched'].includes(kind))throw new HttpError(400,'Select a profile collection.');
      const relation={liked:'likes',saved:'savedBy',watched:'watchedBy'}[kind];send(res,200,await catalogue(url,{[relation]:{some:{userId:session.userId}}}));return true;
    }
    const libraryItem=/^\/api\/me\/videos\/([\w-]+)\/(liked|saved)$/.exec(path);
    if(libraryItem&&method==='POST'){
      limit(req,'library',120,60000);const session=await actor(req,res,{required:true,csrf:true}),data=await body(req);
      if(typeof data.selected!=='boolean')throw new HttpError(400,'Choose whether to keep this video.');
      if(!isUUID(libraryItem[1]))throw new HttpError(404,'Video not found.');const video=await db.video.findFirst({where:{publicId:libraryItem[1],...publicVideoWhere},select:{id:true,publicId:true}});if(!video)throw new HttpError(404,'Video not found.');
      const model=libraryItem[2]==='liked'?db.videoLike:db.savedVideo,where={userId:session.userId,videoId:video.id};
      if(data.selected)await model.upsert({where:{userId_videoId:where},create:where,update:{}});else await model.deleteMany({where});
      send(res,200,{videoId:video.publicId,selected:data.selected});return true;
    }
    if(['/api/auth/register','/api/auth/login'].includes(path)&&method==='POST'){
      limit(req,path,path.endsWith('register')?8:20,15*60000);const data=await body(req),input=username(data.username),pass=password(data.password);let user;
      if(path.endsWith('register')){if(!(await settings.get()).registrationOpen)throw new HttpError(403,'New account registration is currently closed.');try{user=await db.user.create({data:{...input,passwordHash:await hashPassword(pass)}});}catch(error){if(error.code==='P2002')throw new HttpError(409,'This username is unavailable.','USERNAME_UNAVAILABLE');throw error;}}
      else{user=await db.user.findUnique({where:{usernameCanonical:input.usernameCanonical}});const valid=await verifyPassword(pass,user?.passwordHash||await hashPassword('Unregistered-account-timing-placeholder'));if(!user||!valid)throw new HttpError(401,'Username or password is incorrect.');if(user.status!=='ACTIVE')throw new HttpError(403,'This account is suspended. Contact support.');}
      const previous=cookies(req)[SESSION];if(previous)await db.userSession.deleteMany({where:{tokenHash:hash(previous)}});
      send(res,path.endsWith('register')?201:200,await newSession(res,user));return true;
    }
    if(path==='/api/auth/logout'&&method==='POST'){const session=await actor(req,res,{required:true,csrf:true});await db.userSession.delete({where:{id:session.id}});cookie(res,SESSION,'',{production,age:0});send(res,200,{signedOut:true});return true;}
    if(path==='/api/me/membership'&&isGet){const session=await actor(req,res,{required:true});const history=await db.membership.findMany({where:{userId:session.userId},orderBy:{activatedAt:'desc'}});send(res,200,{current:publicMembership(await membership(session.userId)),history:history.map(publicMembership),requests:(await db.subscriptionRequest.findMany({where:{userId:session.userId},orderBy:{createdAt:'desc'},take:50})).map(r=>publicRequest(r,contact))});return true;}
    if(path==='/api/subscription-requests'&&method==='POST'){limit(req,'requests',15,60000);const session=await actor(req,res,{required:true,csrf:true}),data=await body(req);send(res,201,publicRequest(await newRequest(session.user,data.planId,data.videoId),contact));return true;}
    const ownRequest=/^\/api\/subscription-requests\/(HH-[A-F0-9]{16})$/.exec(path);
    if(ownRequest&&isGet){const session=await actor(req,res,{required:true}),record=await db.subscriptionRequest.findFirst({where:{reference:ownRequest[1],userId:session.userId}});if(!record)throw new HttpError(404,'Subscription request not found.');send(res,200,publicRequest(record,contact));return true;}
    const playback=/^\/api\/videos\/([\w-]+)\/playback$/.exec(path);
    if(playback&&method==='POST'){limit(req,'playback-start',40,60000);const data=await body(req);send(res,201,await playbackAuth.authorize(req,res,playback[1],data.position??0));return true;}
    const beat=/^\/api\/playback\/([\w-]+)\/heartbeat$/.exec(path);
    if(beat&&method==='POST'){limit(req,'heartbeat',240,60000);send(res,200,await heartbeat(req,res,beat[1],await body(req)));return true;}
    if(path.startsWith('/api/admin/')){
      const admin=await adminAuth(req);if(method!=='GET')limit(req,'admin-mutation',120,60000);if(await administration.handle(req,res,url,admin))return true;const page=pager(url),q=(url.searchParams.get('q')||'').trim();if(q.length>100)throw new HttpError(400,'Search is too long.');
      if(path==='/api/admin/overview'&&isGet){send(res,200,await overview());return true;}
      if(path==='/api/admin/users'&&isGet){const where=q?{usernameCanonical:{contains:q.toLowerCase()}}:{};send(res,200,{items:(await db.user.findMany({where,...page,orderBy:{createdAt:'desc'},select:{id:true,username:true,status:true,version:true,createdAt:true,memberships:{orderBy:{expiresAt:'desc'},take:1}}})).map(u=>({...u,memberships:u.memberships.map(publicMembership)})),total:await db.user.count({where})});return true;}
      const userPath=/^\/api\/admin\/users\/([\w-]+)(?:\/(status))?$/.exec(path);
      if(userPath){if(!isUUID(userPath[1]))throw new HttpError(400,'Invalid user ID.');if(isGet&&!userPath[2]){const user=await db.user.findUnique({where:{id:userPath[1]},select:{id:true,username:true,status:true,version:true,createdAt:true,memberships:{orderBy:{activatedAt:'desc'}},requests:{orderBy:{createdAt:'desc'}}}});if(!user)throw new HttpError(404,'User not found.');send(res,200,{...user,memberships:user.memberships.map(publicMembership)});return true;}
        if(method==='POST'&&userPath[2]==='status'){const data=await body(req);if(!['ACTIVE','SUSPENDED'].includes(data.status)||!Number.isInteger(data.version)||typeof data.note!=='string'||data.note.trim().length<3||data.note.length>4000)throw new HttpError(400,'Select a status and enter a reason.');const result=await db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM ${table('hh_users')} WHERE id=${userPath[1]}::uuid FOR UPDATE`;const user=await tx.user.findUnique({where:{id:userPath[1]}});if(!user)throw new HttpError(404,'User not found.');if(user.version!==data.version)throw new HttpError(409,'This account changed. Refresh first.');const changed=await tx.user.update({where:{id:user.id},data:{status:data.status,suspensionReason:data.status==='SUSPENDED'?data.note.trim():null,statusChangedAt:snapshot(),statusChangedBy:admin.id,version:{increment:1}}});if(data.status==='SUSPENDED')await tx.userSession.deleteMany({where:{userId:user.id}});await audit(tx,admin,data.status==='SUSPENDED'?'ACCOUNT_SUSPENDED':'ACCOUNT_RESTORED','User',user.id,{status:user.status},{status:changed.status},{userId:user.id,note:data.note.trim()});return {...userDTO(changed),version:changed.version};});send(res,200,result);return true;}}
      if(path==='/api/admin/subscription-requests'&&isGet){const status=url.searchParams.get('status')||'PENDING';if(!['PENDING','APPROVED','REJECTED','ALL'].includes(status))throw new HttpError(400,'Invalid request status.');const where={...(status==='ALL'?{}:{status}),...(q?{OR:[{reference:{contains:q,mode:'insensitive'}},{usernameSnapshot:{contains:q,mode:'insensitive'}}]}:{})};send(res,200,{items:await db.subscriptionRequest.findMany({where,...page,orderBy:{createdAt:'desc'}}),total:await db.subscriptionRequest.count({where})});return true;}
      const requestPath=/^\/api\/admin\/subscription-requests\/([\w-]+)$/.exec(path);
      if(requestPath){if(!isUUID(requestPath[1]))throw new HttpError(400,'Invalid request ID.');if(isGet){const record=await db.subscriptionRequest.findUnique({where:{id:requestPath[1]},include:{user:{select:{id:true,username:true,status:true}},membership:true,auditLogs:{orderBy:{createdAt:'desc'}}}});if(!record)throw new HttpError(404,'Request not found.');send(res,200,record);return true;}if(method==='POST'){send(res,200,await processRequest(requestPath[1],await body(req),admin));return true;}}
      if(path==='/api/admin/memberships'&&isGet){const status=url.searchParams.get('status')||'active';if(!['active','expired','all'].includes(status))throw new HttpError(400,'Invalid membership status.');const where={...(status==='active'?{revokedAt:null,expiresAt:{gt:snapshot()}}:status==='expired'?{OR:[{expiresAt:{lte:snapshot()}},{revokedAt:{not:null}}]}:{}),...(q?{user:{usernameCanonical:{contains:q.toLowerCase()}}}:{})};send(res,200,{items:await db.membership.findMany({where,...page,include:{user:{select:{id:true,username:true}}},orderBy:{activatedAt:'desc'}}),total:await db.membership.count({where})});return true;}
      const revoke=/^\/api\/admin\/memberships\/([\w-]+)\/revoke$/.exec(path);
      if(revoke&&method==='POST'){const data=await body(req);if(!isUUID(revoke[1])||typeof data.note!=='string'||data.note.trim().length<3||data.note.length>4000)throw new HttpError(400,'Enter a revocation reason.');const target=await db.membership.findUnique({where:{id:revoke[1]},select:{userId:true}});if(!target)throw new HttpError(404,'Membership not found.');const result=await db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM ${table('hh_users')} WHERE id=${target.userId}::uuid FOR UPDATE`;await tx.$queryRaw`SELECT id FROM ${table('hh_memberships')} WHERE id=${revoke[1]}::uuid FOR UPDATE`;const m=await tx.membership.findUnique({where:{id:revoke[1]}});if(!m)throw new HttpError(404,'Membership not found.');if(data.version!==undefined&&m.version!==data.version)throw new HttpError(409,'Membership changed. Refresh first.');if(m.revokedAt)return m;const changed=await tx.membership.update({where:{id:m.id},data:{revokedAt:snapshot(),revokeReason:data.note.trim(),version:{increment:1}}});await audit(tx,admin,'MEMBERSHIP_REVOKED','Membership',m.id,m,changed,{userId:m.userId,requestId:m.requestId,note:data.note.trim()});return changed;});send(res,200,result);return true;}
      if(path==='/api/admin/videos'&&isGet){const result=await catalogue(url);const views=await db.video.findMany({where:{id:{in:result.items.map(v=>v.id)}},select:{id:true,_count:{select:{views:true}}}}),counts=new Map(views.map(v=>[v.id,v._count.views]));send(res,200,{...result,items:result.items.map(v=>({...v,qualifiedViews:counts.get(v.id)||0}))});return true;}
      if(path==='/api/admin/audit-logs'&&isGet){send(res,200,{items:await db.adminAuditLog.findMany({...page,orderBy:{createdAt:'desc'}}),total:await db.adminAuditLog.count()});return true;}
      throw new HttpError(404,'Administrator endpoint not found.');
    }
    if(/^\/api\/(auth|me|subscription-requests|playback)(\/|$)/.test(path))throw new HttpError(404,'Endpoint not found.');
    return false;
  }
  return {db,config,handle,actor,authorizeMedia,playback:playbackAuth,settings,catalogue,processRequest,heartbeat,newRequest,overview,attachSync(state){syncState=state;},async health(){await Promise.all([db.platformSettings.count(),db.administrator.count(),db.video.findFirst({select:{published:true,adminUnavailable:true,publicId:true,accessType:true}})]);return true;},async close(){await db.$disconnect();}};
}
