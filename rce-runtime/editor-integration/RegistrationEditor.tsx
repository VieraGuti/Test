'use client';
import {useState} from 'react';
import type {WorkflowNode} from '../core/types';
import {registrationSettings,QUICK_CHAT_CHOICES,validateRegistration,emoteLabel} from '../core/participation';
import './node-library.css';
export function RegistrationEditor({node,onChange}:{node:WorkflowNode;onChange:(node:WorkflowNode)=>void}){
 const p=registrationSettings(node.params);
 const [query,setQuery]=useState('');
 const matches=QUICK_CHAT_CHOICES.filter(c=>!query.trim()||(c.label+' '+c.category).toLowerCase().includes(query.trim().toLowerCase()));
 const categories=[...new Set(QUICK_CHAT_CHOICES.map(c=>c.category))];
 const choicesFor=(value:string,other:string)=>categories.map(category=>{const items=QUICK_CHAT_CHOICES.filter(c=>c.category===category&&(c.value===value||matches.includes(c)));return items.length?<optgroup key={category} label={category}>{items.map(c=><option key={c.value} value={c.value} disabled={c.value===other}>{c.label}</option>)}</optgroup>:null;});
 const setPair=(join:string,leave:string)=>onChange({...node,params:{...p,joinEmote:join,leaveEmote:leave}});
 const change=(key:string,value:string|number)=>onChange({...node,params:{...p,[key]:value}});
 const errors=validateRegistration(p);
 return <div className="rce-reg-editor">
 <p>Choose how players register. Discord uses linked identities. SERVER Quick Chat uses the player identity reported by Rust.</p>
 <label className="rce-guide-field"><strong>Registration method</strong><select value={p.mode} onChange={e=>change('mode',e.target.value)}><option value="discord">Discord buttons</option><option value="game">In-game Quick Chat</option><option value="both">Discord + in-game</option></select></label>
 <label className="rce-guide-field"><strong>Registration duration (seconds)</strong><input type="number" min={1} max={3600} value={p.seconds} onChange={e=>{if(Number.isFinite(e.target.valueAsNumber))change('seconds',Math.max(1,Math.min(3600,Math.trunc(e.target.valueAsNumber))))}}/></label>
 {p.mode!=='discord'&&<>
 <div className="rce-guide-field"><strong>Quick Chat — {QUICK_CHAT_CHOICES.length} messages</strong><input type="search" placeholder="Search messages or categories…" value={query} onChange={e=>setQuery(e.target.value)}/><small>{matches.length} matching messages · Only SERVER Quick Chat</small></div>
 <div className="rce-guide-field"><strong>Suggested pairs</strong><div style={{display:'flex',flexWrap:'wrap',gap:6}}>{[{name:'Quick join',join:0,leave:1},{name:'Friendly',join:5,leave:6}].map(pair=><button key={pair.name} className="rce-v2-secondary" type="button" onClick={()=>{setQuery('');setPair('d11_quick_chat_responses_slot_'+pair.join,'d11_quick_chat_responses_slot_'+pair.leave)}}>{pair.name}</button>)}<button className="rce-v2-secondary" type="button" onClick={()=>{setQuery('');setPair('d11_quick_chat_orders_slot_5','d11_quick_chat_combat_slot_1')}}>PvP / retreat</button></div></div>
 <label className="rce-guide-field"><strong>Join emote</strong><select value={p.joinEmote} onChange={e=>change('joinEmote',e.target.value)}>{choicesFor(p.joinEmote,p.leaveEmote)}</select><small>Players choose this option in SERVER Quick Chat to join.</small></label>
 <label className="rce-guide-field"><strong>Leave emote</strong><select value={p.leaveEmote} onChange={e=>change('leaveEmote',e.target.value)}>{choicesFor(p.leaveEmote,p.joinEmote)}</select><small>Withdraw before registration closes. Choose a different emote.</small></label>
 <label className="rce-guide-field"><strong>Opening announcement</strong><textarea rows={4} maxLength={400} value={p.sayMessage} onChange={e=>change('sayMessage',e.target.value)}/><small>Variables: {'{event.name}'}, {'{join.emote}'}, {'{leave.emote}'}</small></label>
 <div className="rce-guide-example">{p.sayMessage.replaceAll('{join.emote}',emoteLabel(p.joinEmote)).replaceAll('{leave.emote}',emoteLabel(p.leaveEmote)).replaceAll('{event.name}','Your event')}</div>
 <label className="rce-guide-field"><strong>Closing announcement</strong><textarea rows={3} maxLength={400} value={p.sayClosedMessage} onChange={e=>change('sayClosedMessage',e.target.value)}/><small>Use {'{event.players}'} to show the final participant count.</small></label>
 <p>Only SERVER Quick Chat is accepted. Physical character animations are not verified.</p>
 </>}
 {errors.map(e=><p role="alert" key={e} style={{color:'#f5b5ab'}}>{e}</p>)}
 </div>;
}