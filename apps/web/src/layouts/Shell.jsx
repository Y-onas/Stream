import {useAccount} from '../hooks/useAccount';
import {useState} from 'react';
import {Link,navigate} from '../hooks/useRoute';
import {Icon} from '../components/Icons';
export function Shell({children,path,query,setQuery}){
  const [search,setSearch]=useState(false),account=useAccount(),platformName=account?.platform?.platformName||'Habeshan HUB';
  const bottom=[['/','home','Home'],['/browse','search','Search'],['/premium','premium','Premium'],['/me','me','Profile']];
  const active=url=>url==='/'?path==='/':path.startsWith(url);
  function submit(event){event.preventDefault();navigate('/browse');setSearch(false);}
  return <><a className="skip-link" href="#main">Skip to content</a><header className="header">
    <Link className="brand" to="/" aria-label={`${platformName} home`}><span className="wordmark">{platformName==='Habeshan HUB'?<>Habeshan <i>HUB</i></>:platformName}</span></Link>
    <form className={`header-search ${search?'mobile-open':''}`} onSubmit={submit}><Icon name="search"/><input aria-label="Search videos" placeholder="Search videos" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button type="button" aria-label="Clear search" onClick={()=>setQuery('')}><Icon name="close" size={17}/></button>}</form>
    <nav className="desktop-nav" aria-label="Main navigation">{[['/','home','Home'],['/browse','search','Search']].map(([url,icon,label])=><Link key={url} className={`nav-pill ${active(url)?'current':''}`} to={url}><Icon name={icon}/>{label}</Link>)}</nav>
    <Link className="premium nav-pill" to="/premium"><Icon name="premium" size={17}/><span>Premium</span></Link><Link className="nav-pill profile-link" to="/me"><Icon name="me"/>Your HUB</Link><button className="mobile-search round-control" aria-label="Open search" aria-expanded={search} onClick={()=>{setSearch(!search);setTimeout(()=>document.querySelector('.header-search input')?.focus(),0);}}><Icon name="search" size={18}/></button>
  </header><main id="main">{children}</main><nav className="bottom-nav" aria-label="Bottom navigation">{bottom.map(([url,icon,label])=><Link key={url} to={url} aria-current={active(url)?'page':undefined} className={active(url)?'active':''}><Icon name={icon} size={19}/><span>{label}</span></Link>)}</nav></>;
}
