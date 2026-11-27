import React,{useEffect,useId,useRef,useState} from 'react';

// Spline geometry and gradients copied from the reference RevenuePage.
// Use pixel-sized chart coordinates so labels remain readable in compact cards.
export default function SeriesChart({title,series,field}){
 const [hover,setHover]=useState(null),[width,setWidth]=useState(400),plot=useRef(null),id=useId().replaceAll(':','');
 useEffect(()=>{const element=plot.current;const measure=()=>{if(element.clientWidth)setWidth(element.clientWidth);};measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();},[]);
 useEffect(()=>setHover(null),[series,field]);
 const colors={views:'#f69b61',registrations:'#36bca9',activeUsers:'#5e92bf',activeMemberships:'#36bca9',activations:'#f69b61',expirations:'#c7ac77'},color=colors[field]||'#f69b61';
 const svgHeight=172,paddingX=27,paddingY=16,plotWidth=Math.max(1,width-paddingX*2),plotHeight=svgHeight-paddingY*2,maxY=Math.max(1,...series.map(row=>row[field])),total=series.reduce((sum,row)=>sum+row[field],0);
 const points=series.map((row,index)=>({x:paddingX+(series.length===1?.5:index/(series.length-1))*plotWidth,y:paddingY+(1-row[field]/maxY)*plotHeight,val:row[field],date:row.date}));
 const pathD=points.reduce((acc,pt,index)=>{if(index===0)return `M ${pt.x} ${pt.y}`;const prev=points[index-1],cpX=(prev.x+pt.x)/2;return `${acc} C ${cpX} ${prev.y}, ${cpX} ${pt.y}, ${pt.x} ${pt.y}`;},'');
 const areaD=points.length?`${pathD} L ${points.at(-1).x} ${svgHeight-paddingY} L ${points[0].x} ${svgHeight-paddingY} Z`:'';
 const format=value=>new Intl.NumberFormat().format(value),selected=points[hover]||points.at(-1),ticks=[...new Set([0,Math.round(maxY/2),maxY])];
 function inspect(event){if(!points.length)return;if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();setHover(index=>event.key==='Home'?0:event.key==='End'?points.length-1:Math.min(points.length-1,Math.max(0,(index??points.length-1)+(event.key==='ArrowLeft'?-1:1))));}
 return <section className="analytics-card analytics-chart rounded-card glass-card p-5 border border-white/[0.08]">
  <header className="chart-heading"><h2>{title}</h2><span>{field==='activeMemberships'?'At interval end':`${series.length} intervals`}</span></header>
  <div className="chart-plot" ref={plot}><svg viewBox={`0 0 ${width} ${svgHeight}`} role="img" tabIndex={0} onKeyDown={inspect} onBlur={()=>setHover(null)} aria-label={`${title}. Use left and right arrow keys to inspect reporting intervals.`}>
   <defs><linearGradient id={'area-'+id} x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor={color} stopOpacity=".35"/><stop offset="85%" stopColor={color} stopOpacity=".04"/><stop offset="100%" stopColor="#171f29" stopOpacity="0"/></linearGradient></defs>
   {ticks.map(value=>{const y=paddingY+(1-value/maxY)*plotHeight;return <g key={value}><line x1={paddingX} x2={width-paddingX} y1={y} y2={y} stroke="rgba(255,255,255,.06)" strokeDasharray={value===0?undefined:'3 3'}/><text x={paddingX-7} y={y+3} fill="#8e98a4" fontSize="10" textAnchor="end" fontFamily="monospace">{format(value)}</text></g>;})}
   <path d={areaD} fill={`url(#area-${id})`}/><path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"/>
   {points.length===1&&<circle cx={points[0].x} cy={points[0].y} r="3" fill={color}/>}
   {hover!==null&&points[hover]&&<g><line x1={points[hover].x} x2={points[hover].x} y1={paddingY} y2={svgHeight-paddingY} stroke="rgba(255,255,255,.3)" strokeDasharray="3 3"/><circle cx={points[hover].x} cy={points[hover].y} r="3" fill={color}/></g>}
   {points.map((point,index)=>{const left=index?(points[index-1].x+point.x)/2:paddingX,right=index===points.length-1?width-paddingX:(point.x+points[index+1].x)/2;return <rect key={point.date} x={left} y={paddingY} width={Math.max(1,right-left)} height={plotHeight} fill="transparent" onMouseEnter={()=>setHover(index)} onMouseLeave={()=>setHover(null)}><title>{`${point.date}: ${format(point.val)}`}</title></rect>;})}
  </svg></div>
  <div className="chart-axis"><span>{series[0]?.date}</span><span>{series.at(-1)?.date}</span></div>
  <p className="chart-inspector" aria-live="polite">{!total?'No activity in this period.':selected?`${selected.date} · ${format(selected.val)}`:'No reporting intervals.'}</p>
 </section>;
}
