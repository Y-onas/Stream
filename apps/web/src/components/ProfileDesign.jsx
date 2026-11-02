import {useEffect,useRef,useState} from 'react';
import {Icon} from './Icons';
import {Link} from '../hooks/useRoute';
import {useAccount,AccountRequired} from '../hooks/useAccount';
import {MembershipPanel} from '../pages/Subscription';
import {Catalogue} from '../pages/Catalogue';
import {api} from '../services/api.mjs';
function EditProfile({account,onClose}){
  const ref=useRef(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{const dialog=ref.current;dialog.showModal();return()=>dialog.close();},[]);
  async function save(event){event.preventDefault();setBusy(true);setError('');try{await api('/me/profile',{method:'POST',json:{displayName:String(new FormData(event.currentTarget).get('displayName')||'')}});await account.refresh();onClose();}catch(error){setError(error.message);}finally{setBusy(false);}}
  return <dialog className="profile-dialog" ref={ref} onCancel={onClose} aria-labelledby="profile-edit-title"><div className="dialog-heading"><h2 id="profile-edit-title">Edit profile</h2><button className="round-control" onClick={onClose} aria-label="Close dialog"><Icon name="close"/></button></div><form className="profile-edit-form" onSubmit={save}><label htmlFor="profile-display-name">Display name</label><input id="profile-display-name" name="displayName" maxLength={50} defaultValue={account.user.displayName||''} autoComplete="nickname"/><p>Username: @{account.user.username}</p>{error&&<p className="form-error" role="alert">{error}</p>}<div className="profile-form-actions"><button type="button" className="nav-pill" onClick={onClose}>Cancel</button><button className="gold-button" disabled={busy}>{busy?'Saving…':'Save changes'}</button></div></form></dialog>;
}
export function ProfileDesign({path='/me'}){
  const account=useAccount(),[editing,setEditing]=useState(false),[error,setError]=useState('');
  if(account.loading||!account.user)return <AccountRequired/>;
  const user=account.user,library=account.library,counts=library?.counts,name=user.displayName||user.username;
  const current=library?library.membership:account.membership;
  const sections=[['watched','Watched','eye','/me/watched'],['saved','Watchlist','saved','/saved'],['liked','Liked','liked','/me/liked']];
  const collection=path==='/me/liked'?'liked':path==='/me/watched'?'watched':null;
  async function signOut(){setError('');try{await account.logout();}catch(error){setError(error.message);}}
  return <div className="hub-profile">
    <section className="profile-hero" aria-label="Your Habeshan HUB profile"><p className="eyebrow">YOUR HABESHAN HUB</p><button className="nav-pill profile-edit" onClick={()=>setEditing(true)}><Icon name="filter" size={16}/>Edit profile</button><div className="profile-identity"><div className="profile-avatar" aria-hidden="true">{name[0].toUpperCase()}</div><div><h1>{name}</h1><span className="profile-handle">@{user.username}</span><p className="profile-intro">Joined {new Date(user.createdAt).toLocaleDateString(undefined,{month:'long',year:'numeric'})}</p></div></div></section>
    <nav className="profile-sections account-profile-sections" aria-label="Your profile sections">{sections.map(([key,label,icon,to])=><Link key={key} to={to} aria-current={path===to?'page':undefined}><Icon name={icon}/><span>{label}<strong>{counts?counts[key]:'—'}</strong></span><Icon name="right" size={15}/></Link>)}<Link to="/me/membership" aria-current={path==='/me/membership'?'page':undefined}><Icon name="premium"/><span>Membership<strong>{library?(current?current.planName:'No active membership'):'Loading…'}</strong></span><Icon name="right" size={15}/></Link></nav>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {collection&&<section className="profile-collection"><Link className="back-link" to="/me"><Icon name="left" size={16}/>Your profile</Link><Catalogue key={`${user.id}:${collection}`} query="" saved={library?.savedIds||[]} onSave={id=>void account.toggleVideo(id,'saved')} page={collection}/></section>}
    {path==='/me/membership'&&<section className="profile-content-panel"><Link className="back-link" to="/me"><Icon name="left" size={16}/>Your profile</Link><h2><Icon name="premium"/>Membership</h2><MembershipPanel/></section>}
    {path==='/me'&&<section className="profile-content-panel"><h2><Icon name="premium"/>Your membership</h2>{library?current?<><p>{current.planName}</p><p className="muted">Expires {new Date(current.expiresAt).toLocaleString()}</p></>:<p className="muted">You have no active membership.</p>:<p role="status">Loading membership…</p>}<Link className="nav-pill" to="/me/membership">Membership details<Icon name="right" size={16}/></Link></section>}
    <section className="support-panel"><div className="support-heading"><span className="support-icon"><Icon name="support" size={24}/></span><div><h2>Contact support</h2><p>{account.platform?.supportUrl?'Get in touch with our support team.':'The support contact has not been configured.'}</p></div></div>{account.platform?.supportUrl&&<a className="support-message" href={account.platform.supportUrl} target="_blank" rel="noopener noreferrer">Message support<Icon name="right" size={18}/></a>}</section>
    <div className="profile-signout"><button className="nav-pill" onClick={signOut}>Sign out</button></div>
    {editing&&<EditProfile account={account} onClose={()=>setEditing(false)}/>}
  </div>;
}
