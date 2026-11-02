import {useEffect,useRef,useState} from 'react';
import {Icon} from './Icons';
import {Link} from '../hooks/useRoute';
import {readLocal,writeLocal} from '../hooks/useLocal.mjs';
import {useAccount} from '../hooks/useAccount';
import {MembershipPanel} from '../pages/Subscription';

function ProfileDialog({title,onClose,children}) {
  const dialog=useRef(null);
  useEffect(()=>{const element=dialog.current;element.showModal();return()=>element.close();},[]);
  return <dialog className="profile-dialog" ref={dialog} aria-labelledby="profile-dialog-title" onCancel={onClose}>
    <div className="dialog-heading"><h2 id="profile-dialog-title">{title}</h2><button className="round-control" aria-label="Close dialog" onClick={onClose}><Icon name="close" size={18}/></button></div>{children}
  </dialog>;
}

export function ProfileDesign({path='/me',videos=[]}) {
  const [profile,setProfile]=useState(()=>readLocal('profile',{})),[editing,setEditing]=useState(false),[support,setSupport]=useState(false),[error,setError]=useState('');
  const account=useAccount();
  const artwork=videos.find(video=>video.artwork)?.artwork;
  function save(event){
    event.preventDefault();const data=new FormData(event.currentTarget);
    const next={displayName:String(data.get('displayName')||'').trim(),username:String(data.get('username')||'').trim()};
    if(!writeLocal('profile',next)){setError('Your changes could not be saved on this device.');return;}
    setProfile(next);setEditing(false);setError('');
  }
  const liked=path==='/me/liked',membership=path==='/me/membership';
  return <div className="hub-profile">
    <section className="profile-hero" aria-label="Your Habeshan HUB profile">
      {artwork&&<img className="profile-hero-art" src={artwork} alt=""/>}
      <p className="eyebrow">YOUR HABESHAN HUB</p>
      <button className="nav-pill profile-edit" onClick={()=>{setError('');if(account.user)account.logout().catch(e=>setError(e.message));else setEditing(true);}}><Icon name="filter" size={16}/>{account.user?'Sign out':'Edit profile'}</button>
      <div className="profile-identity"><div className="profile-avatar" aria-hidden="true">{account.user?account.user.username[0].toUpperCase():profile.displayName?profile.displayName[0].toUpperCase():<Icon name="me" size={43}/>}</div><div><h1>{account.user?.username||profile.displayName||'Your profile'}</h1>{account.user||profile.username?<span className="profile-handle">@{account.user?.username||profile.username}</span>:<p className="profile-intro">Your own corner of Habeshan HUB.</p>}</div></div>
    </section>
    {!account.user&&<div className="account-access"><p>Sign in to manage your membership.</p><Link className="gold-button" to="/account?mode=login">Log in / Create account</Link></div>}
    {error&&!editing&&<p role="alert" className="form-error">{error}</p>}
    <nav className="profile-sections" aria-label="Your profile sections">
      <Link to="/saved"><Icon name="saved"/><span>Watchlist</span><Icon name="right" size={15}/></Link>
      <Link to="/me/liked" aria-current={liked?'page':undefined}><Icon name="liked"/><span>Liked</span><Icon name="right" size={15}/></Link>
      <Link to="/me/membership" aria-current={membership?'page':undefined}><Icon name="premium"/><span>Membership</span><Icon name="right" size={15}/></Link>
    </nav>
    {(liked||membership)&&<section className="profile-content-panel">
      <Link className="back-link" to="/me"><Icon name="left" size={16}/>Your Habeshan HUB</Link>
      <h2><Icon name={liked?'liked':'premium'}/>{liked?'Liked videos':'Membership'}</h2>
      {liked?<div className="profile-collection-empty"><Icon name="liked" size={30}/><h3>A home for your favourites.</h3><p>Your liked videos will be collected here. There are no liked-video records available to display.</p></div>:<MembershipPanel/>}
    </section>}
    <section className="support-panel"><div className="support-heading"><span className="support-icon"><Icon name="support" size={24}/></span><div><h2>Contact support</h2><p>Need a hand with Habeshan HUB? Get in touch with our support team.</p></div></div>{account.platform?.supportUrl?<a className="support-message" href={account.platform.supportUrl} target="_blank" rel="noopener noreferrer">Message support<Icon name="right" size={18}/></a>:<button className="support-message" onClick={()=>setSupport(true)}>Message support<Icon name="right" size={18}/></button>}</section>
    {editing&&<ProfileDialog title="Edit your profile" onClose={()=>setEditing(false)}><form className="profile-edit-form" onSubmit={save}><label htmlFor="profile-name">Display name</label><input id="profile-name" name="displayName" maxLength={50} defaultValue={profile.displayName||''} placeholder="Your name" autoComplete="nickname"/><label htmlFor="profile-username">Username</label><input id="profile-username" name="username" maxLength={30} pattern="[A-Za-z0-9_]+" defaultValue={profile.username||''} placeholder="username" title="Use letters, numbers and underscores"/><p>Profile changes are saved on this device.</p>{error&&<p role="alert">{error}</p>}<div className="profile-form-actions"><button type="button" className="nav-pill" onClick={()=>setEditing(false)}>Cancel</button><button className="gold-button" type="submit">Save changes</button></div></form></ProfileDialog>}
    {support&&<ProfileDialog title="Contact support" onClose={()=>setSupport(false)}><p className="support-contact-note">The Telegram support contact has not been configured. There is no contact link available to open.</p><button className="gold-button" onClick={()=>setSupport(false)}>Close</button></ProfileDialog>}
  </div>;
}
