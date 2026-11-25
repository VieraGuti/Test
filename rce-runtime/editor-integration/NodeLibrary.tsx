'use client';
import {useMemo,useState} from 'react';
import {NODE_GUIDES,PARAM_GUIDES} from '../core/node-guides';
import {ENTITIES} from '../core/catalog';
import {QUICK_CHAT_CHOICES,validateRegistration} from '../core/participation';
import {NODE_PRESETS,searchNodePresets,presetNode} from '../core/node-library';
import type {NodePreset} from '../core/node-library';
import type {WorkflowNode} from '../core/types';
import './node-library.css';
const groups=['Triggers','Registration','Players','Equipment','World','Spawning','Timing','Conditions','Scoring','Discord','Results','Cleanup'];
const icons:Record<string,string>={Triggers:'⚡',Registration:'＋',Players:'◎',Equipment:'◇',World:'⊕',Spawning:'▱',Timing:'◷',Conditions:'⑂',Scoring:'☆',Discord:'▤',Results:'♜',Cleanup:'✓'};
export function NodeLibrary({onAdd,onDragStart}:{onAdd:(node:WorkflowNode)=>void;onDragStart?:(event:React.DragEvent<HTMLButtonElement>,preset:NodePreset)=>void}){
 const [query,setQuery]=useState(''),[collapsed,setCollapsed]=useState<string[]>([]),[mode,setMode]=useState<'all'|'actions'>('all');
 const [selected,setSelected]=useState<NodePreset|null>(null),[draft,setDraft]=useState<WorkflowNode|null>(null);
 function inspect(p:NodePreset){setSelected(p);setDraft(presetNode(p.id,crypto.randomUUID(),{x:100,y:100}));}
 function change(key:string,value:string|number|boolean){setDraft(prev=>prev?{...prev,params:{...prev.params,[key]:value}}:prev);}
 const items=useMemo(()=>{const matches=searchNodePresets(query);return mode==='all'?matches:matches.filter(p=>NODE_PRESETS.find(n=>n.kind===p.kind)?.id===p.id)},[query,mode]);
 return <aside className="rce-library" aria-label="Workflow node library">
 <header><strong>NODE LIBRARY</strong><span>{NODE_PRESETS.length} presets</span></header>
 <input type="search" placeholder="Find a node..." value={query} onChange={e=>setQuery(e.target.value)} aria-label="Find a node"/>
 <div className="rce-lib-switch"><button aria-pressed={mode==='all'} onClick={()=>setMode('all')}>All presets</button><button aria-pressed={mode==='actions'} onClick={()=>setMode('actions')}>Core actions</button></div>
 <p className="rce-lib-hint">Click to learn and configure, or drag a preset onto the canvas.</p>
 <div className="rce-lib-scroll">{groups.map(group=>{const nodes=items.filter(p=>p.category===group);if(!nodes.length)return null;const open=!!query||!collapsed.includes(group);return <section key={group}><button className="rce-lib-group" aria-expanded={open} onClick={()=>setCollapsed(prev=>prev.includes(group)?prev.filter(x=>x!==group):[...prev,group])}><span>{group}</span><small>{nodes.length} {open?'⌄':'›'}</small></button>{open&&nodes.map(p=><button type="button" key={p.id} className="rce-lib-node" draggable={!!onDragStart} onDragStart={e=>{e.dataTransfer.setData('application/rce-node-preset',p.id);e.dataTransfer.effectAllowed='copy';onDragStart?.(e,p)}} aria-haspopup="dialog" onClick={()=>inspect(p)}><span className="rce-lib-icon">{icons[group]}</span><span><strong>{p.label}</strong><small>{p.description}</small></span><span className="rce-lib-grip">⋮⋮</span></button>)}</section>})}{!items.length&&<p className="rce-lib-hint">No matching nodes. Try kit, wolf, timer or Discord.</p>}</div>
 {selected&&draft&&<section role="dialog" aria-label={selected.label+' details'} className="rce-node-guide" onKeyDown={e=>{if(e.key==='Escape'){setSelected(null);setDraft(null)}}}>
 <div className="rce-guide-header"><div><small>{selected.category.toUpperCase()}</small><h3>{selected.label}</h3></div><button type="button" aria-label="Close node details" onClick={()=>{setSelected(null);setDraft(null)}}>×</button></div>
 <p>{NODE_GUIDES[selected.kind].effect}</p>
 <h4>BEFORE YOU USE IT</h4><ul>{NODE_GUIDES[selected.kind].needs.map(n=><li key={n}>{n}</li>)}</ul>
 <h4>EXAMPLE WORKFLOW</h4><div className="rce-guide-example">{NODE_GUIDES[selected.kind].example}</div>
 <h4>CONFIGURATION</h4>
 {Object.entries(draft.params).filter(([k])=>!(['joinEmote','leaveEmote','sayMessage','sayClosedMessage'].includes(k)&&draft.params.mode==='discord')&&!(['x','y','z'].includes(k)&&draft.params.useArena!==false)&&!(['stone','sulfur','metal'].includes(k)&&draft.params.layout!=='big-node')).map(([k,v])=>{const meta=PARAM_GUIDES[k]||{label:k,help:''};return <label className="rce-guide-field" key={k}><strong>{meta.label}</strong>{k==='mode'||k==='joinEmote'||k==='leaveEmote'?<select value={String(v)} onChange={e=>change(k,e.target.value)}>{(k==='mode'?[{value:'discord',label:'Discord buttons'},{value:'game',label:'In-game Quick Chat'},{value:'both',label:'Discord + in-game'}]:QUICK_CHAT_CHOICES).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:k==='entity'||k==='layout'?<select value={String(v)} onChange={e=>change(k,e.target.value)}>{(k==='entity'?ENTITIES:['point','ring','big-node']).map(option=><option key={option} value={option}>{option}</option>)}</select>:typeof v==='boolean'?<input type="checkbox" checked={v} onChange={e=>change(k,e.target.checked)}/>:typeof v==='number'?<input type="number" min={k==='radius'&&selected.kind==='zone.create'?5:meta.min} max={meta.max} step={['x','y','z','radius'].includes(k)?'any':1} value={v} onChange={e=>change(k,e.target.valueAsNumber)}/>:['message','sayMessage','sayClosedMessage'].includes(k)?<textarea rows={3} maxLength={k==='message'?1900:400} value={v} onChange={e=>change(k,e.target.value)}/>:<input type="text" maxLength={64} value={v} onChange={e=>change(k,e.target.value)}/>}<small>{meta.help}</small></label>})}
 {!Object.keys(draft.params).length&&<p className="rce-lib-hint">No individual parameters. This node uses the event configuration.</p>}
 {selected.kind==='registration.open'&&validateRegistration(draft.params).map(error=><p key={error} role="alert">{error}</p>)}
 <div className="rce-guide-note"><strong>Important</strong><p>{NODE_GUIDES[selected.kind].warning}</p></div>
 <button type="button" className="rce-guide-add" disabled={(selected.kind==='registration.open'&&validateRegistration(draft.params).length>0)||Object.entries(draft.params).some(([k,v])=>typeof v==='number'&&(!Number.isFinite(v)||v<(k==='radius'&&selected.kind==='zone.create'?5:PARAM_GUIDES[k]?.min??-Infinity)||v>(PARAM_GUIDES[k]?.max??Infinity)||(!['x','y','z','radius','radiation'].includes(k)&&!Number.isInteger(v)))||k==='kit'&&!/^[a-zA-Z0-9 _-]{1,64}$/.test(String(v))||k==='message'&&!String(v).trim())||(draft.params.layout==='big-node'&&(Number(draft.params.stone)+Number(draft.params.sulfur)+Number(draft.params.metal)<1||Number(draft.params.stone)+Number(draft.params.sulfur)+Number(draft.params.metal)>500))} onClick={()=>{onAdd(draft);setSelected(null);setDraft(null)}}>＋ Add configured node</button>
 </section>}
 <footer>Presets use existing engine actions. Verify server kits, arena coordinates and RCON capabilities before publishing.</footer></aside>
}
