import {useRef} from 'react';
import {Icon} from './Icons';
export function Empty({icon='video',title,children}){return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={27}/></span><h3>{title}</h3><p>{children}</p></div>;}
export function Segmented({label,items,value,onChange}){return <div className="segmented" role="group" aria-label={label}>{items.map(([id,text])=><button key={id} className={value===id?'active':''} aria-pressed={value===id} onClick={()=>onChange(id)}>{text}</button>)}</div>;}
export function Rail({children,label}){const ref=useRef(null);return <div className="rail-wrap"><div className="rail" ref={ref} aria-label={label} tabIndex={0}>{children}</div><button className="rail-next round-control" aria-label={`Scroll ${label}`} onClick={()=>ref.current.scrollBy({left:ref.current.clientWidth*.75,behavior:'smooth'})}><Icon name="right"/></button></div>;}
export function Grid({children,label}){return <div className="video-grid" role="list" aria-label={label}>{children}</div>;}
