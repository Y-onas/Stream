export const SORTS=[['latest','Latest'],['most-viewed','Most Viewed'],['longest','Longest'],['oldest','Oldest']];
export function filterVideos(videos,query='',format='all',sort='latest') {
  if(sort==='most-viewed')return null;
  const filtered=videos.filter(v=>`${v.title} ${v.filename||''} ${v.description||''}`.toLowerCase().includes(query.trim().toLowerCase()) && (format==='all'||(v.filename||'').split('.').pop().toLowerCase()===format));
  return [...filtered].sort((a,b)=>sort==='longest'?(b.durationSeconds??-1)-(a.durationSeconds??-1):sort==='oldest'?Date.parse(a.uploadedAt)-Date.parse(b.uploadedAt):Date.parse(b.uploadedAt)-Date.parse(a.uploadedAt));
}
export const formatOf=v=>(v.filename||'').split('.').pop()?.toUpperCase()||'VIDEO';
export function duration(seconds){if(!Number.isFinite(seconds)||seconds<=0)return null;const n=Math.floor(seconds);return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
export const fileSize=bytes=>bytes>=1e9?`${(bytes/1e9).toFixed(2)} GB`:`${(bytes/1e6).toFixed(1)} MB`;
