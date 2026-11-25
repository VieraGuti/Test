import type {Definition,Player,Vec3,WorkflowNode} from './types.ts';
export type Gate={id:string;name:string;position:Vec3;team?:number;slot?:number};
export type Spatial={teams:number;entry:Gate[];respawn:{mode:'disabled'|'entry'|'custom';gates:Gate[];kit:string};exit:{mode:'original'|'entry'|'custom';gates:Gate[]};spectators:Gate[];spectatorOnRespawn?:boolean};
export function defaultSpatial(d:Pick<Definition,'arena'>):Spatial{return {teams:2,entry:[{id:'entry-1',name:'Entry 1',position:{...d.arena}}],respawn:{mode:'disabled',gates:[],kit:''},exit:{mode:'original',gates:[]},spectators:[]};}
export function resolveGate(gates:Gate[],p:Player,index:number,players:Player[]):Vec3{
 const exact=gates.filter(g=>g.slot===index+1);const team=gates.filter(g=>g.slot===undefined&&g.team===p.team);const shared=gates.filter(g=>g.slot===undefined&&g.team===undefined);const pool=exact.length?exact:team.length?team:shared;
 if(!pool.length)throw new Error('No eligible gate for '+p.name);
 const ordinal=team.length&&!exact.length?players.slice(0,index).filter(q=>q.team===p.team).length:index;
 return {...pool[ordinal%pool.length].position};
}
export function assignDestinations(d:Definition,p:Player,players:Player[]){const c=d.spatial||defaultSpatial(d);const index=players.findIndex(q=>q.id===p.id);p.entryGate??=resolveGate(c.entry,p,index,players);if(c.respawn.mode==='entry')p.respawnGate={...p.entryGate};else if(c.respawn.mode==='custom')p.respawnGate??=resolveGate(c.respawn.gates,p,index,players);if(c.exit.mode==='entry')p.exitGate={...p.entryGate};else if(c.exit.mode==='custom')p.exitGate??=resolveGate(c.exit.gates,p,index,players);else if(p.origin)p.exitGate={...p.origin};if(c.spectatorOnRespawn)p.spectatorGate??=resolveGate(c.spectators,p,index,players);}
export function spawnLayout(n:WorkflowNode,d:Definition):{kind:string;position:Vec3}[]{
 const p=n.params,center=p.useArena===false?{x:Number(p.x),y:Number(p.y),z:Number(p.z)}:d.arena;
 const kinds=p.layout==='big-node'?(['stone-ore','sulfur-ore','metal-ore'] as const).flatMap((kind,i)=>Array.from({length:Number(p[['stone','sulfur','metal'][i]]||0)},()=>kind)):Array.from({length:Number(p.count)},()=>String(p.entity));
 const radius=Number(p.radius??40);
 return kinds.map((kind,i)=>{if(p.layout==='point')return {kind,position:{...center}};if(p.layout==='big-node'){const y=kinds.length===1?0:1-2*(i+.5)/kinds.length;const ring=Math.sqrt(1-y*y),angle=i*Math.PI*(3-Math.sqrt(5));return {kind,position:{x:center.x+Math.cos(angle)*ring*radius,y:center.y+y*radius,z:center.z+Math.sin(angle)*ring*radius}};}const angle=i/kinds.length*Math.PI*2;return {kind,position:{x:center.x+Math.cos(angle)*radius,y:center.y,z:center.z+Math.sin(angle)*radius}};});
}
export function validateSpatial(d:Definition):string[]{
 const c=d.spatial;if(!c)return [];const errors:string[]=[];
 if(!Number.isInteger(c.teams)||c.teams<1||c.teams>1000)return ['Team count must be 1–1,000.'];
 if(!c.respawn||!c.exit||!['disabled','entry','custom'].includes(c.respawn.mode)||!['original','entry','custom'].includes(c.exit.mode))return ['Invalid gate policy.'];
 for(const [name,gates] of [['Entry',c.entry],['Respawn',c.respawn.gates],['Exit',c.exit.gates],['Spectator',c.spectators]] as const){
 if(!Array.isArray(gates)||gates.length>2000){errors.push(name+': use at most 2,000 gates per pool.');continue;}
 if(new Set(gates.map(g=>g?.id)).size!==gates.length)errors.push(name+': gate IDs must be unique.');
 for(const g of gates){if(!g||typeof g.id!=='string'||typeof g.name!=='string'||g.name.length>80||!g.position||![g.position.x,g.position.y,g.position.z].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=10000)||g.team!==undefined&&(!Number.isInteger(g.team)||g.team<0||g.team>=c.teams)||g.slot!==undefined&&(!Number.isInteger(g.slot)||g.slot<1||g.slot>d.maxPlayers))errors.push(name+': invalid coordinates or participant/team assignment.');}
 }
 if(typeof c.respawn.kit!=='string'||c.respawn.kit&&!/^[a-zA-Z0-9 _-]{1,64}$/.test(c.respawn.kit))errors.push('Invalid respawn kit name.');
 if(errors.length)return errors;
 const players=Array.from({length:Math.min(d.maxPlayers,1000)},(_,i)=>({id:String(i),name:'Slot '+(i+1),team:i%c.teams}) as Player);
 for(const [name,gates] of [['Entry',c.entry],...(c.respawn.mode==='custom'?[['Respawn',c.respawn.gates] as const]:[]),...(c.exit.mode==='custom'?[['Exit',c.exit.gates] as const]:[]),...(c.spectatorOnRespawn?[['Spectator',c.spectators] as const]:[])] as const){try{players.forEach((p,i)=>resolveGate(gates,p,i,players));}catch{errors.push(name+': every participant needs a matching slot, team or shared gate.');}}
 return errors;
}