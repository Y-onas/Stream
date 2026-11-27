import {useState} from 'react';
import {useAccount} from '../hooks/useAccount';

export function AccountSecurity(){
 const account=useAccount(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function change(event){event.preventDefault();const data=new FormData(event.currentTarget);setError('');setBusy(true);try{await account.changePassword({currentPassword:String(data.get('currentPassword')),newPassword:String(data.get('newPassword'))});}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function everywhere(){setBusy(true);setError('');try{await account.logout({everywhere:true});}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="profile-content-panel"><h2>Account security</h2><p className="muted">Changing your password or signing out everywhere ends your login and playback sessions on every device.</p><details><summary>Change password</summary><form className="profile-edit-form" onSubmit={change}><label htmlFor="current-password">Current password</label><input id="current-password" name="currentPassword" type="password" required maxLength={128} autoComplete="current-password"/><label htmlFor="new-password">New password</label><input id="new-password" name="newPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/><button className="nav-pill" disabled={busy}>{busy?'Please wait…':'Change password and sign out'}</button></form></details>{error&&<p className="form-error" role="alert">{error}</p>}<button className="nav-pill" disabled={busy} onClick={everywhere}>Sign out all devices</button></section>;
}
