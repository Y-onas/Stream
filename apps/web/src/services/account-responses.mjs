// Both endpoints supply membership. Order their snapshots together so an older
// library response cannot revoke access installed by a newer account refresh.
export function createAccountResponseOrder(){
 let account=0,snapshot=0,applied=0;
 return {
  account(){return {account:++account,snapshot:++snapshot};},
  library(){return {account,snapshot:++snapshot};},
  isAccountCurrent(request){return request.account===account;},
  isCurrent(request){return request.account===account&&request.snapshot>=applied;},
  // A newer pending/failed library read must not delay a successful account
  // refresh. Only a successfully received snapshot advances the commit order.
  accept(request){if(request.account!==account||request.snapshot<applied)return false;applied=request.snapshot;return true;}
 };
}
