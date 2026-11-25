export type KillKind='Player'|'Npc'|'Entity'|'Natural';
type KillActor={name?:unknown;type?:unknown;player?:{ign?:unknown}};
export type KillPayload={server?:{identifier?:unknown};killer?:KillActor;victim?:KillActor};
const clean=(value:unknown)=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,100):'';
const escape=(s:string)=>s.replace(/[\\`*_~|<>\[\]]/g,'\\$&');
export function describeKill(data:KillPayload,serverId:string){
 if(data?.server?.identifier!==serverId||data.victim?.type!=='Player')return null;
 const victim=clean(data.victim.player?.ign)||clean(data.victim.name);
 const killer=clean(data.killer?.player?.ign)||clean(data.killer?.name);
 if(!victim||!killer)return null;
 const kind=data.killer?.type;
 if(kind!=='Player'&&kind!=='Npc'&&kind!=='Entity'&&kind!=='Natural')return null;
 const suicide=kind==='Player'&&killer===victim;
 const title=suicide?'SELF ELIMINATION':kind==='Player'?'PLAYER KILL':kind==='Npc'?'WILDLIFE / NPC':kind==='Entity'?'ENTITY DEATH':'ENVIRONMENT';
 const description=suicide?'**'+escape(victim)+'** eliminated themselves.':kind==='Player'?'**'+escape(killer)+'** eliminated **'+escape(victim)+'**.':'**'+escape(victim)+'** died to **'+escape(killer)+'**.';
 return {victim,killer,kind,suicide,title,description,color:kind==='Player'?0xf2ad73:0x87939a};
}
