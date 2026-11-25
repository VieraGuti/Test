'use client';
import {useMemo,useState} from 'react';
import {NODE_PRESETS,searchNodePresets,presetNode} from '../core/node-library';
import type {NodePreset} from '../core/node-library';
import type {WorkflowNode} from '../core/types';
import './node-library.css';
const groups=['Triggers','Registration','Players','Equipment','World','Spawning','Timing','Conditions','Scoring','Discord','Results','Cleanup'];
const icons:Record<string,string>={Triggers:'⚡',Registration:'＋',Players:'◎',Equipment:'◇',World:'⊕',Spawning:'▱',Timing:'◷',Conditions:'⑂',Scoring:'☆',Discord:'▤',Results:'♜',Cleanup:'✓'};
export function NodeLibrary({onAdd,onDragStart}:{onAdd:(node:WorkflowNode)=>void;onDragStart?:(event:React.DragEvent<HTMLButtonElement>,preset:NodePreset)=>void}){
 const [query,setQuery]=useState(''),[collapsed,setCollapsed]=useState<string[]>([]),[mode,setMode]=useState<'all'|'actions'>('all');
 const items=useMemo(()=>{const matches=searchNodePresets(query);return mode==='all'?matches:matches.filter(p=>NODE_PRESETS.find(n=>n.kind===p.kind)?.id===p.id)},[query,mode]);
 return <aside className="rce-library" aria-label="Workflow node library">
 <header><strong>NODE LIBRARY</strong><span>{NODE_PRESETS.length} presets</span></header>
 <input type="search" placeholder="Find a node..." value={query} onChange={e=>setQuery(e.target.value)} aria-label="Find a node"/>
 <div className="rce-lib-switch"><button aria-pressed={mode==='all'} onClick={()=>setMode('all')}>All presets</button><button aria-pressed={mode==='actions'} onClick={()=>setMode('actions')}>Core actions</button></div>
 <p className="rce-lib-hint">Click to add, or drag onto the canvas.</p>
 <div className="rce-lib-scroll">{groups.map(group=>{const nodes=items.filter(p=>p.category===group);if(!nodes.length)return null;const open=!!query||!collapsed.includes(group);return <section key={group}><button className="rce-lib-group" aria-expanded={open} onClick={()=>setCollapsed(prev=>prev.includes(group)?prev.filter(x=>x!==group):[...prev,group])}><span>{group}</span><small>{nodes.length} {open?'⌄':'›'}</small></button>{open&&nodes.map(p=><button type="button" key={p.id} className="rce-lib-node" draggable={!!onDragStart} onDragStart={e=>{e.dataTransfer.setData('application/rce-node-preset',p.id);e.dataTransfer.effectAllowed='copy';onDragStart?.(e,p)}} onClick={()=>onAdd(presetNode(p.id,crypto.randomUUID(),{x:100,y:100}))}><span className="rce-lib-icon">{icons[group]}</span><span><strong>{p.label}</strong><small>{p.description}</small></span><span className="rce-lib-grip">⋮⋮</span></button>)}</section>})}{!items.length&&<p className="rce-lib-hint">No matching nodes. Try kit, wolf, timer or Discord.</p>}</div>
 <footer>Presets use existing engine actions. Verify server kits, arena coordinates and RCON capabilities before publishing.</footer></aside>
}
