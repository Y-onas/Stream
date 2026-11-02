import {Link} from '../hooks/useRoute';
import {Icon} from './Icons';
import {duration,formatOf} from '../utils/catalogue.mjs';
import {WatchDownloadButton} from './WatchDownloadButton';
import {VideoThumbnail} from './VideoThumbnail';
export function VideoCard({video,landscape=false,grid=false,rank,saved,onSave}){
  const cls=landscape?'landscape':grid?'poster-card grid-card':'poster-card';
  return <article className={`video-card ${cls}`} role={grid?'listitem':undefined}>
    <div className="card-image">
      {video.accessType==='FREE'&&<span className="free-label">FREE</span>}
      <Link to={`/video/${video.id}`} className="art-link" aria-label={`Watch ${video.title}`}>
        <VideoThumbnail video={video} landscape={landscape}/>
        <div className="image-shade"/>
      </Link>
      <Link className="round-control gold play-overlay" to={`/video/${video.id}`} aria-label={`Play ${video.title}`}><Icon name="play" size={15}/></Link>
      <div className="card-actions"><button className={`round-control ${saved?'selected':''}`} title={saved?'Remove from Watchlist':'Save to Watchlist'} aria-label={`${saved?'Unsave':'Save'} ${video.title}`} aria-pressed={saved} onClick={()=>onSave(video.id)}><Icon name={saved?'check':'saved'} size={18}/></button><Link className="round-control" title="Watch video" to={`/video/${video.id}`} aria-label={`Watch video: ${video.title}`}><Icon name="eye" size={17}/></Link><WatchDownloadButton video={video}/></div>
      {duration(video.durationSeconds)&&<span className="duration">{duration(video.durationSeconds)}</span>}
      {landscape&&<div className="landscape-caption">{rank&&<strong className="rank">{rank}</strong>}<div><Link to={`/video/${video.id}`}>{video.title}</Link><p><span className="gold-text">{formatOf(video)}</span>{duration(video.durationSeconds)&&<span>· {duration(video.durationSeconds)}</span>}</p></div></div>}
    </div>
    {!landscape&&<div className="card-caption"><Link to={`/video/${video.id}`}>{video.title}</Link><span className="added">Added</span><div className="metadata-pills"><span>{formatOf(video)}</span></div></div>}
  </article>;
}
