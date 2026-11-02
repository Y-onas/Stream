import {Icon} from './Icons';

// Supply onRequest(video) when the selected-video Telegram action is available.
// Until then, keep the entry explicit and avoid simulating a download.
export function WatchDownloadButton({video,onRequest}) {
  const label=onRequest?'Watch / Download':'Watch / Download — Telegram delivery is not available yet';
  return <button type="button" className="round-control download-action" title={label} aria-label={`${label}: ${video.title}`} aria-disabled={!onRequest} onClick={()=>onRequest?.(video)}><Icon name="download" size={17}/></button>;
}
