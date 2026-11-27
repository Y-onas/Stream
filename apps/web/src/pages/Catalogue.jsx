import {useEffect,useRef,useState} from 'react';
import {api} from '../services/api.mjs';
import {filterVideos,SORTS} from '../utils/catalogue.mjs';
import {VideoCard} from '../components/VideoCard';
import {Empty,Segmented,Rail,Grid} from '../components/Common';
import {Icon} from '../components/Icons';
import {useAccount} from '../hooks/useAccount';
export function Catalogue({videos,loading,error,query,saved,onSave,page='home',retry}){
  // Retain the existing filter implementation for future use, but do not render
  // it. Its default remains "all", so every supported source format is included.
  const showFormatFilters=false;
  const [free,setFree]=useState(null),[freeError,setFreeError]=useState(false);
  useEffect(()=>{if(page!=='home')return;const abort=new AbortController();let busy=false;const refresh=async()=>{if(busy)return;busy=true;try{const data=await api('/videos?access=FREE&sort=latest&limit=24',{signal:abort.signal});setFree(data);setFreeError(false);}catch(e){if(e.name!=='AbortError')setFreeError(true);}finally{busy=false;}};void refresh();const timer=setInterval(refresh,15000);return()=>{abort.abort();clearInterval(timer);};},[page]);
  const [sort,setSort]=useState('latest'),[format,setFormat]=useState('all'),[period,setPeriod]=useState('day'),[trending,setTrending]=useState(null),[trendError,setTrendError]=useState(false);
  useEffect(()=>{const abort=new AbortController();setTrending(null);setTrendError(false);api(`/trending?period=${period}`,{signal:abort.signal}).then(setTrending).catch(e=>{if(e.name!=='AbortError')setTrendError(true);});return()=>abort.abort();},[period]);
  const [listing,setListing]=useState({items:[],loading:true}),loadedMore=useRef(false),[moreBusy,setMoreBusy]=useState(false),[reload,setReload]=useState(0);
  const account=useAccount(),collection=['saved','liked','watched'].includes(page)?page:null;
  const collectionRevision=collection==='saved'?account.library?.savedIds.join(','):collection==='liked'?account.library?.likedIds.join(','):account.library?.counts.watched;
  const endpoint=`${collection?`/me/videos?kind=${collection}&`:'/videos?'}${page==='home'?'access=VIP&':''}sort=${encodeURIComponent(sort)}&q=${encodeURIComponent(query)}&limit=24`;
  useEffect(()=>{const abort=new AbortController();let busy=false;loadedMore.current=false;setListing({items:[],loading:true});const refresh=async()=>{if(busy||loadedMore.current)return;if(collection&&!account.user){setListing({items:[],loading:false});return;}busy=true;try{const data=await api(endpoint,{signal:abort.signal});setListing({...data,loading:false});}catch(e){if(e.name!=='AbortError')setListing(old=>({...old,loading:false,error:e.message}));}finally{busy=false;}};void refresh();const timer=setInterval(refresh,15000);return()=>{abort.abort();clearInterval(timer);};},[endpoint,page,account.user?.id,reload,collection?collectionRevision:null]);
  async function more(){if(!listing.nextCursor||moreBusy)return;loadedMore.current=true;setMoreBusy(true);try{const data=await api(`${endpoint}&cursor=${encodeURIComponent(listing.nextCursor)}`);setListing(old=>({...data,loading:false,items:[...new Map([...old.items,...data.items].map(v=>[v.id,v])).values()]}));}catch(e){setListing(old=>({...old,error:e.message}));}finally{setMoreBusy(false);}}
  const items=listing.available===false?null:listing.source==='telegram-sync'?filterVideos(listing.items,query,format,sort):listing.items;
  const catalogueError=listing.error||(error&&'Videos could not load.');
  const formats=[['all','All','browse'],['mp4','MP4','film'],['mov','MOV','phone'],['webm','WebM','screen'],['mkv','MKV','video']];
  const card=(video,landscape=false,rank,grid=false)=> <VideoCard key={video.id} video={video} landscape={landscape} grid={grid} rank={rank} saved={saved.includes(video.id)} onSave={onSave}/>;
  return <div className={`catalogue page-${page}`}>
    {showFormatFilters&&page!=='home'&&<div className="format-bar" role="group" aria-label="Video formats">{formats.map(([id,text,icon])=><button key={id} className={`format-pill ${format===id?'active':''}`} aria-pressed={format===id} onClick={()=>setFormat(id)}><Icon name={icon} size={17}/>{text}</button>)}</div>}
    {page==='home'&&<section className="trending-section"><div className="section-heading"><h2>Trending <Icon name="right"/></h2><Segmented label="Trending period" items={[["day","Day"],["week","Week"],["month","Month"]]} value={period} onChange={setPeriod}/></div>
      {trendError?<Empty title="Trending couldn't load">Please try another period or return later.</Empty>:!trending?<div className="loading-panel" role="status"><Icon name="loading" className="spin"/>Loading trending videos…</div>:trending.available===false?<Empty icon="film" title="The next favourite is still to come">Trending will appear when viewing activity is available.</Empty>:trending.items?.length?<Rail label="Trending videos">{trending.items.slice(0,24).map((v,index)=>card(v,true,index+1))}</Rail>:<Empty icon="film" title="No trending videos yet">No videos qualify for this period. Explore the latest additions below.</Empty>}
    </section>}
    {page==='home'&&<section className="free-section"><div className="section-heading"><h2>Free Videos <Icon name="right"/></h2><span className="section-note">Watch without an account</span></div>{free?.items?.length?<Rail label="Free videos">{free.items.map(video=>card(video,true))}</Rail>:freeError?<Empty title="Free videos couldn't load">Please try again shortly.</Empty>:!free?<div className="loading-panel" role="status">Loading free videos…</div>:<Empty title="No free videos yet">Free videos will appear here when published.</Empty>}</section>}
    <section className="latest-section"><div className="section-heading"><h1>{page==='saved'?'Watchlist':page==='liked'?'Liked videos':page==='watched'?'Watched videos':page==='browse'?'Search':'VIP Videos'} <Icon name="right"/></h1><Segmented label="Sort videos" items={SORTS} value={sort} onChange={setSort}/></div>
      {page==='saved'&&<p className="section-note">Your Watchlist, saved to your account.</p>}
      {query&&<p className="section-note">Search results for “{query}”</p>}
      {catalogueError?<Empty icon="error" title="Videos couldn't load"><span>{catalogueError}</span><button className="text-button" onClick={()=>{setReload(n=>n+1);retry?.();}}>Try again</button></Empty>:listing.loading?<div className="loading-panel" role="status"><Icon name="loading" className="spin"/>Loading videos…</div>:items===null?<Empty icon="eye" title="Ranking is unavailable">Please try again when the statistics service is available.</Empty>:items.length?<><Grid label="Latest videos">{items.map(v=>card(v,false,undefined,true))}</Grid>{sort==='longest'&&items.some(v=>!v.durationSeconds)&&<p className="section-note">Videos without a known duration appear last.</p>}{listing.nextCursor&&<div className="catalogue-more"><button className="nav-pill" onClick={more} disabled={moreBusy}>{moreBusy?'Loading…':'Load more videos'}</button></div>}</>:<Empty icon={page==='saved'?'saved':'search'} title={collection?`No ${collection==='saved'?'saved':collection} videos yet`:'No videos found'}>{page==='saved'?'Tap the bookmark on a video to keep it here.':page==='liked'?'Like a video while watching to keep it here.':page==='watched'?'Videos you watch while signed in will appear here.':'Try a different search.'}</Empty>}
    </section>
  </div>;
}
