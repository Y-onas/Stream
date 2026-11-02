import {useAccount} from '../hooks/useAccount';
import {Icon} from './Icons';
export function LikeButton({video}){
  const account=useAccount(),selected=!!account.library?.likedIds.includes(video.id);
  return <button className={`nav-pill ${selected?'current':''}`} aria-pressed={selected} disabled={account.loading||!!account.user&&!account.library} onClick={()=>void account.toggleVideo(video.id,'liked')}><Icon name="liked"/>{selected?'Liked':'Like'}</button>;
}
