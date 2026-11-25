import {validatePhaseMedia} from './embed-media.ts';
import {validateRegistration} from './participation.ts';
import {validateSpatial,spawnLayout} from './spatial.ts';
import {ACTIONS,ENTITIES} from './catalog.ts';
import type {Definition,WorkflowNode} from './types.ts';
export function validateDefinition(d:Definition):string[] {
 const errors:string[]=[];
 if(!d||d.schemaVersion!==1) return ['Unsupported workflow schema version.'];
 if(typeof d.name!=='string'||!d.name.trim()||d.name.length>80)errors.push('Event name must contain 1–80 characters.');
 if(!Number.isInteger(d.maxPlayers)||d.maxPlayers<1||d.maxPlayers>1000)errors.push('Participants must be between 1 and 1,000.');
 if(!d.arena||![d.arena.x,d.arena.y,d.arena.z].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=10000))errors.push('Arena coordinates must be finite and within ±10,000.');
 if(!Array.isArray(d.nodes)||d.nodes.length<2||d.nodes.length>80||!Array.isArray(d.edges)||d.edges.length>120)return [...errors,'Workflows require 2–80 nodes and at most 120 connections.'];
 if(d.nodes.some(n=>!n||typeof n!=='object')||d.edges.some(e=>!e||typeof e!=='object'))return [...errors,'Invalid workflow elements.'];
 errors.push(...validateSpatial(d));
 const ids=new Set(d.nodes.map(n=>n.id));
 if(ids.size!==d.nodes.length)errors.push('Node IDs must be unique.');
 const starts=d.nodes.filter(n=>n.kind==='event.started');
 if(starts.length!==1)errors.push('Add exactly one Event started trigger.');
 if(!d.nodes.some(n=>n.kind==='event.end'))errors.push('Add an End & clean up node.');
 for(const n of d.nodes){
 if(!/^[\w-]{1,80}$/.test(n.id)||!ACTIONS.some(a=>a.kind===n.kind)){errors.push('Unknown or invalid workflow action.');continue;}
 if(!n.params||typeof n.params!=='object'||Array.isArray(n.params)){errors.push(n.label+': invalid parameters.');continue;}
 if(Object.keys(n.params).some(k=>!Object.hasOwn(ACTIONS.find(a=>a.kind===n.kind)!.params,k)))errors.push(n.label+': unknown parameters.');
 for(const value of Object.values(n.params))if(!['string','number','boolean'].includes(typeof value)||(typeof value==='string'&&value.length>2000))errors.push(n.label+': invalid parameter value.');
 const num=(key:string,min:number,max:number)=>{const v=n.params[key];if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)errors.push(n.label+': '+key+' must be '+min+'–'+max+'.');};
 if(n.kind==='entity.spawn'){if(!ENTITIES.includes(String(n.params.entity)))errors.push('Entity is not in the verified capability registry.');num('count',1,500);if(!Number.isInteger(n.params.count))errors.push('Spawn count must be an integer.');}
 if(n.kind==='entity.spawn'){if(n.params.layout!==undefined&&!['ring','point','big-node'].includes(String(n.params.layout)))errors.push('Invalid spawn layout.');if(n.params.radius!==undefined)num('radius',0,500);if(n.params.useArena===false)for(const axis of ['x','y','z'])num(axis,-10000,10000);if(n.params.layout==='big-node'){for(const key of ['stone','sulfur','metal']){num(key,0,500);if(!Number.isInteger(n.params[key]))errors.push('Resource counts must be integers.');}const total=Number(n.params.stone)+Number(n.params.sulfur)+Number(n.params.metal);if(total<1||total>500)errors.push('Big Node requires 1–500 resource entities.');}}
 if(n.kind==='registration.open'||n.kind==='timer.wait')num('seconds',1,3600);
 if(n.kind==='registration.open')errors.push(...validateRegistration(n.params));
 if(n.kind==='zone.create'){num('radius',5,500);num('radiation',0,100);}
 if(n.kind==='score.add')num('points',1,10000);
 if(n.kind==='logic.remaining')num('maximum',0,1000);
 if(n.kind==='kits.give'&&!/^[a-zA-Z0-9 _-]{1,64}$/.test(String(n.params.kit||'')))errors.push('Invalid kit name.');
 const out=d.edges.filter(e=>e.source===n.id);
 if(n.kind==='event.end'&&out.length)errors.push('End nodes cannot have outgoing connections.');
 if(n.kind!=='event.end'&&n.kind!=='logic.remaining'&&out.length!==1)errors.push(n.label+': connect exactly one next step.');
 if(n.kind==='logic.remaining'&&(out.length!==2||!out.some(e=>e.branch==='yes')||!out.some(e=>e.branch==='no')))errors.push('Conditions require one Yes and one No connection.');
 }
 for(const e of d.edges)if(!ids.has(e.source)||!ids.has(e.target)||e.source===e.target)errors.push('A connection references an invalid node.');
 if(starts.length===1){const visited=new Set<string>();let paths=0;
 function walk(id:string,stack:Set<string>,saved:boolean,teleported:boolean,returned:boolean){
 if(++paths>1000){errors.push('Workflow is too complex.');return;}
 if(stack.has(id)){errors.push('Loops are not supported.');return;}
 const n=d.nodes.find(n=>n.id===id);if(!n)return;visited.add(id);const next=new Set(stack);next.add(id);
 saved=saved||n.kind==='positions.save';
 if(n.kind==='players.teleport'){if(!saved)errors.push('Save original positions before every teleport path.');teleported=true;returned=false;}
 if(n.kind==='players.return')returned=true;
 if(n.kind==='event.end'&&teleported&&!returned)errors.push('Every teleport path must restore players before ending.');
 for(const e of d.edges.filter(e=>e.source===id))walk(e.target,next,saved,teleported,returned);
 }walk(starts[0].id,new Set(),false,false,false);
 if(visited.size!==d.nodes.length)errors.push('Connect all nodes to the event trigger.');
 }
 if(d.nodes.filter(n=>n.kind==='entity.spawn').reduce((sum,n)=>sum+(n.params?.layout==='big-node'?Number(n.params.stone||0)+Number(n.params.sulfur||0)+Number(n.params.metal||0):Number(n.params?.count||0)),0)>2000)errors.push('A workflow can spawn at most 2,000 entities.');
 if(d.nodes.filter(n=>['timer.wait','registration.open'].includes(n.kind)).reduce((sum,n)=>sum+Number(n.params?.seconds||0),0)>7200)errors.push('Total configured waits cannot exceed two hours.');
 if(!d.embed||typeof d.embed.title!=='string'||d.embed.title.length>256||typeof d.embed.description!=='string'||d.embed.description.length>4000||typeof d.embed.footer!=='string'||d.embed.footer.length>512||!/^#[0-9a-f]{6}$/i.test(d.embed.color))errors.push('Embed exceeds Discord limits or contains an invalid color.');
 for(const url of [d.embed?.image,d.embed?.thumbnail])if(url&&(!/^https:\/\//.test(url)||url.length>1500))errors.push('Embed images must use HTTPS URLs.');
 if(!validatePhaseMedia(d.embed?.mediaByPhase))errors.push('Invalid event phase artwork.');
 if(!errors.length)for(const n of d.nodes.filter(n=>n.kind==='entity.spawn'))if(spawnLayout(n,d).some(e=>[e.position.x,e.position.y,e.position.z].some(v=>Math.abs(v)>10000)))errors.push('Spawn distribution exceeds supported world coordinates.');
 return [...new Set(errors)];
}
export function assertDefinition(value:unknown):Definition{const errors=validateDefinition(value as Definition);if(errors.length)throw new Error(errors.join(' '));return value as Definition;}
export function validateDraft(d:Definition):string[]{return validateDefinition(d).filter(message=>!(/connect exactly one|Conditions require|Connect all nodes|Save original positions|Every teleport path|every participant needs/.test(message)));}