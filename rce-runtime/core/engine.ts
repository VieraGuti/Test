import type {Definition, EngineState, Frame, Player, SimulationResult, Vec3, WorkflowNode} from './types.ts';
import {assertDefinition} from './validation.ts';
import {commands,coords} from './commands.ts';
import {assignDestinations,spawnLayout} from './spatial.ts';
export interface Adapter {
 checkpoint(state:EngineState):Promise<void>;
 readPosition(player:Player):Promise<Vec3>;
 command(command:string,context:{kind:string;player?:Player;destination?:Vec3;kit?:string}):Promise<void>;
 announce(message:string,definition:Definition,state:EngineState):Promise<void>;
 wait(seconds:number,state:EngineState,node:WorkflowNode):Promise<void>;
}
export function log(state:EngineState,nodeId:string,message:string,level:'info'|'success'|'warning'|'error'='info',command?:string){state.logs.push({seq:state.logs.length+1,time:state.now,nodeId,message,level,...(command?{command}:{})});}
export function rng(state:EngineState){state.rng=(Math.imul(1664525,state.rng)+1013904223)>>>0;return state.rng/4294967296;}
export function initialState(d:Definition,mode:'simulation'|'live',players:Player[]=[],seed=42):EngineState {assertDefinition(d);return {mode,runId:mode==='simulation'?`sim-${seed}`:crypto.randomUUID(),now:0,status:'READY',current:d.nodes.find(n=>n.kind==='event.started')!.id,completed:[],players,entities:[],zones:[],logs:[],rng:seed>>>0||42,registrationOpen:false,failure:'none',failureUsed:false,commands:0};}
export function renderVariables(text:string,d:Definition,s:EngineState){const vars:Record<string,string>={'event.name':d.name,'event.players':String(s.players.length),'event.max_players':String(d.maxPlayers),'event.status':s.status,'event.winner':s.winner||'No sole winner','event.time_left':'—','player.name':s.players[0]?.name||'','player.kills':String(s.players[0]?.score||0),'team.score':String(s.players.reduce((n,p)=>n+p.score,0))};return text.replace(/\{([a-z._]+)\}/g,(full,key)=>vars[key]??full);}
async function command(a:Adapter,s:EngineState,n:WorkflowNode,cmd:string,player?:Player,destination?:Vec3){s.commands++;await a.checkpoint(s);await a.command(cmd,{kind:n.kind,player,destination});log(s,n.id,cmd,'info',cmd);}
export async function restorePlayers(a:Adapter,s:EngineState,n:WorkflowNode){for(const p of s.players){if(!p.origin||p.returned)continue;p.pendingReturn=true;await a.checkpoint(s);if(!p.online||!p.alive){log(s,n.id,`${p.name}: return saved for reconnect / respawn.`,'warning');continue;}await command(a,s,n,commands.teleport(p.name,p.exitGate||p.origin),p,p.exitGate||p.origin);p.position={...(p.exitGate||p.origin)};p.returned=true;p.pendingReturn=false;await a.checkpoint(s);log(s,n.id,`${p.name} returned to ${p.exitGate&&coords(p.exitGate)!==coords(p.origin)?'configured exit gate':'saved original position'} ${coords(p.position)}.`,'success');await a.checkpoint(s);}}
export async function respawnPlayer(d:Definition,s:EngineState,a:Adapter,p:Player){
 if(!p.origin||p.returned||p.recoveryPending||!['RUNNING'].includes(s.status)||!d.spatial||d.spatial.respawn.mode==='disabled'&&!d.spatial.spectatorOnRespawn)return;
 assignDestinations(d,p,s.players);const spectate=d.spatial.respawn.mode==='disabled';const target=spectate?p.spectatorGate:p.respawnGate;if(!target)return;p.recoveryPending=true;p.pendingReturn=true;await a.checkpoint(s);
 try{await a.command(commands.teleport(p.name,target),{kind:'players.teleport',player:p,destination:target});p.position={...target};const kit=spectate?'':d.spatial.respawn.kit;if(kit){await a.command(commands.kit(p.name,kit),{kind:'kits.give',player:p,kit});p.kit=kit;}p.alive=!spectate;p.spectating=spectate;p.online=true;p.recoveryPending=false;log(s,'respawn',`${p.name} moved to their ${spectate?'spectator':'respawn'} gate.`);await a.checkpoint(s);}catch{ s.status='NEEDS_REVIEW';log(s,'respawn',`${p.name}: respawn action needs review; no automatic repeat.`,'error');await a.checkpoint(s);}
}
export async function stepEngine(d:Definition,s:EngineState,a:Adapter):Promise<boolean>{
 if(['COMPLETED','CANCELLED','NEEDS_REVIEW'].includes(s.status)||!s.current)return false;
 const n=d.nodes.find(n=>n.id===s.current);if(!n)throw new Error('Missing workflow node.');
 if(s.pending){s.status='NEEDS_REVIEW';log(s,n.id,'Interrupted operation requires reconciliation. No reward, kit or spawn was repeated.','warning');await a.checkpoint(s);return false;}
 s.status='RUNNING';s.pending={nodeId:n.id,kind:n.kind};await a.checkpoint(s);
 let branch:'yes'|'no'|undefined;
 try {
  switch(n.kind){
   case 'event.started': log(s,n.id,`${d.name} started.`,'success'); break;
   case 'registration.open': s.registrationOpen=true;log(s,n.id,'Registration opened.');await a.wait(Number(n.params.seconds),s,n);s.registrationOpen=false;log(s,n.id,`Registration closed · ${s.players.length} participants.`);break;
   case 'positions.save': for(const p of s.players.filter(p=>p.online)){if(!p.origin){const cmd=commands.position(p.name);s.commands++;log(s,n.id,cmd,'info',cmd);await a.checkpoint(s);const origin=await a.readPosition(p);coords(origin);p.origin={...origin};await a.checkpoint(s);log(s,n.id,`${p.name}: original position saved ${coords(p.origin)}.`,'success');await a.checkpoint(s);}}break;
   case 'players.teleport': for(const p of s.players.filter(p=>p.online&&p.alive)){if(!p.origin)throw new Error(`No return position for ${p.name}.`);assignDestinations(d,p,s.players);p.pendingReturn=true;p.returned=false;await a.checkpoint(s);await command(a,s,n,commands.teleport(p.name,p.entryGate!),p,p.entryGate);p.position={...p.entryGate!};await a.checkpoint(s);}break;
   case 'kits.give': for(const p of s.players.filter(p=>p.online&&p.alive)){await command(a,s,n,commands.kit(p.name,String(n.params.kit)),p);p.kit=String(n.params.kit);}break;
   case 'zone.create': {const zone={name:`rcec_${s.runId.slice(0,24)}_${n.id}`,position:{...d.arena},radius:Number(n.params.radius),radiation:Number(n.params.radiation)};s.zones.push(zone);await a.checkpoint(s);await command(a,s,n,commands.zone(zone.name,zone.position,zone.radius,zone.radiation,!!n.params.pvp));break;}
   case 'entity.spawn': for(const [i,entity] of spawnLayout(n,d).entries()){await command(a,s,n,commands.spawn(entity.kind,entity.position));s.entities.push({id:`${n.id}-${i}`,...entity});}break;
   case 'timer.wait': await a.wait(Number(n.params.seconds),s,n);break;
   case 'logic.remaining': {const alive=s.players.filter(p=>p.online&&p.alive).length;branch=alive<=Number(n.params.maximum)?'yes':'no';log(s,n.id,`${alive} remaining ≤ ${n.params.maximum}: ${branch.toUpperCase()}.`);break;}
   case 'score.add': for(const p of s.players.filter(p=>p.alive&&p.online))p.score+=Number(n.params.points);log(s,n.id,`Added ${n.params.points} points to eligible participants.`);break;
   case 'discord.send': await a.announce(renderVariables(String(n.params.message),d,s),d,s);log(s,n.id,'Discord embed sent.');break;
   case 'winner.announce': {const eligible=s.players.filter(p=>p.alive&&p.online);s.winner=eligible.length===1?eligible[0].name:undefined;const message=s.winner?`${s.winner} wins ${d.name}.`:`${d.name} finished with ${eligible.length} survivors. No sole winner.`;await a.announce(message,d,s);log(s,n.id,message,'success');break;}
   case 'players.return': await restorePlayers(a,s,n);break;
   case 'event.end': for(const zone of [...s.zones]){await command(a,s,n,commands.deleteZone(zone.name));s.zones=s.zones.filter(z=>z.name!==zone.name);await a.checkpoint(s);}s.status='COMPLETED';log(s,n.id,'Event completed. Return records retained.','success');if(s.entities.length)log(s,n.id,'Spawned entities may remain in the world. Individual despawn is not verified.','warning');break;
  }
  s.completed.push(n.id);s.pending=undefined;s.current=d.edges.find(e=>e.source===n.id&&(!branch||e.branch===branch))?.target??null;
  await a.checkpoint(s);return s.current!==null&&s.status==='RUNNING';
 } catch(err){s.status='NEEDS_REVIEW';log(s,n.id,err instanceof Error?err.message:'Action failed.','error');await a.checkpoint(s);return false;}
}
export function frame(s:EngineState):Frame{return structuredClone({time:s.now,nodeId:s.pending?.nodeId||s.current,status:s.status,players:s.players,entities:s.entities,zones:s.zones,logCount:s.logs.length});}
export async function simulate(definition:Definition,options:{seed:number;players:number;failure?:string}):Promise<SimulationResult>{
 const d=assertDefinition(structuredClone(definition));
 if(!Number.isInteger(options.seed)||options.seed<1||options.seed>2147483647)throw new Error('Seed must be 1–2147483647.');
 if(!Number.isInteger(options.players)||options.players<1||options.players>Math.min(d.maxPlayers,100))throw new Error('Virtual participants exceed the event capacity.');
 const s=initialState(d,'simulation',[],options.seed);s.failure=options.failure||'none';
 s.players=Array.from({length:options.players},(_,i)=>({id:`p${i+1}`,name:`Player${String(i+1).padStart(2,'0')}`,team:i%(d.spatial?.teams||2),position:{x:Math.round(rng(s)*220-110),y:20,z:Math.round(rng(s)*220-110)},online:true,alive:true,score:0,returned:false,pendingReturn:false,trail:[]}));
 const frames:Frame[]=[frame(s)];let saved:EngineState|undefined;let sampled=false;
 const capture=()=>{if(frames.length>=128){const retained=frames.filter((_,i)=>i===0||i%2===1);frames.splice(0,frames.length,...retained);sampled=true;}frames.push(frame(s));};
 const inject=(kind:string)=>{if(s.failureUsed)return;const errors:Record<string,string>={rcon_timeout:'positions.save',teleport_failed:'players.teleport',missing_kit:'kits.give',invalid_zone:'zone.create',spawn_failed:'entity.spawn'};if(errors[s.failure]===kind){s.failureUsed=true;throw new Error(`Injected scenario: ${s.failure.replaceAll('_',' ')}. Outcome not assumed; manual reconciliation required.`);}};
 const adapter:Adapter={
  async checkpoint(state){if(s.failure==='bot_restart')saved=structuredClone(state);},
  async readPosition(p){inject('positions.save');return {...p.position};},
  async command(_cmd,context){inject(context.kind);},
  async announce(message){log(s,s.current!,'Simulated Discord: '+message);},
  async wait(seconds,state,node){
   const steps=node.kind==='registration.open'?1:Math.min(24,Math.max(1,Math.ceil(seconds/5)));
   for(let i=0;i<steps;i++){
    state.now+=seconds/steps;
    if(node.kind==='timer.wait'){
     for(const p of state.players.filter(p=>p.online&&p.alive)){p.trail.push({...p.position});if(p.trail.length>20)p.trail.shift();p.position={x:d.arena.x+Math.cos(rng(s)*6.283)*rng(s)*50,y:d.arena.y,z:d.arena.z+Math.sin(rng(s)*6.283)*rng(s)*50};}
     if(!s.failureUsed&&s.failure==='player_offline'){s.players[0].online=false;s.failureUsed=true;log(s,node.id,`${s.players[0].name} disconnected (injected).`,'warning');}
     const combat=state.entities.some(e=>['wolf','bear','boar'].includes(e.kind))||d.nodes.some(n=>n.kind==='zone.create'&&!!n.params.pvp);
     const alive=state.players.filter(p=>p.online&&p.alive);
     if(combat&&alive.length>1){const remove=Math.max(1,Math.ceil((alive.length-1)/(steps-i)));for(let j=0;j<remove&&alive.length>1;j++){const p=alive.splice(Math.floor(rng(s)*alive.length),1)[0];p.alive=false;log(s,node.id,`Scenario: ${p.name} eliminated (synthetic combat).`);}}
     if(d.spatial&&(d.spatial.respawn.mode!=='disabled'||d.spatial.spectatorOnRespawn))for(const p of state.players.filter(p=>!p.alive&&p.online&&!p.spectating))await respawnPlayer(d,s,adapter,p);
     for(const e of state.entities.filter(e=>['wolf','bear','boar'].includes(e.kind))){e.position.x=d.arena.x+Math.cos(rng(s)*6.283)*40;e.position.z=d.arena.z+Math.sin(rng(s)*6.283)*40;}
     if(!s.failureUsed&&s.failure==='double_elimination'){const p=s.players.find(p=>!p.alive);if(p){s.failureUsed=true;log(s,node.id,`Duplicate elimination for ${p.name} ignored.`,'warning');}}
    }
    capture();
   }
  }
 };
 let steps=0;
 while(s.current&&s.status!=='COMPLETED'&&s.status!=='NEEDS_REVIEW'&&steps++<100){
  const node=d.nodes.find(n=>n.id===s.current)!;
  if(node.kind==='players.return'){
   for(const p of s.players.filter(p=>!p.alive&&p.online)){p.alive=true;log(s,node.id,`Scenario: ${p.name} respawned before return.`);}
   if(s.failure==='death_before_return'&&!s.failureUsed){s.failureUsed=true;s.players[0].alive=false;log(s,node.id,'Injected death before return. Return remains pending.','warning');}
  }
  await stepEngine(d,s,adapter);
  if(s.failure==='bot_restart'&&!s.failureUsed&&node.kind==='timer.wait'&&saved){const restored=structuredClone(saved);Object.assign(s,restored);s.failureUsed=true;log(s,node.id,'Simulated restart: persisted checkpoint reloaded; completed actions not repeated.','warning');}
  capture();
 }
 if(s.status==='NEEDS_REVIEW'){
  const recovery:WorkflowNode={id:'recovery',kind:'players.return',label:'Failure recovery',position:{x:0,y:0},params:{}};
  try{await restorePlayers(adapter,s,recovery);}catch{log(s,'recovery','Recovery could not complete. Saved return records retained.','error');}
  capture();
 }
 const errors=s.logs.filter(l=>l.level==='error').map(l=>l.message);const pending=s.players.filter(p=>p.pendingReturn).length;
 const warnings=[...new Set(s.logs.filter(l=>l.level==='warning').map(l=>l.message))];
 if(sampled)warnings.push('Replay snapshots were sampled to bound memory. The full action timeline is retained.');
 if(pending)warnings.push(`${pending} participant return(s) pending reconnect or respawn.`);
 return {seed:options.seed,definition:d,frames,state:s,report:{passed:s.status==='COMPLETED'&&!errors.length,errors,warnings,returned:s.players.filter(p=>p.returned).length,pending,commands:s.commands,duration:Math.round(s.now)}};
}