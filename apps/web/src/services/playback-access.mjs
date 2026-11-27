// This snapshot can deny the UI early; it can never authorize media delivery.
// Node still checks the current account/membership before returning any URL.
export function lacksVipMembership(account,video,at=Date.now()){
 if(video?.accessType!=='VIP'||account.loading)return false;
 const member=account.membership;
 return !account.user||!member||member.status!=='ACTIVE'||!!member.revokedAt||!Number.isFinite(Date.parse(member.expiresAt))||Date.parse(member.expiresAt)<=at;
}
