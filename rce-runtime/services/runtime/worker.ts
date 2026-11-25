import {discordMedia,type EmbedScope} from '../../core/embed-media.ts';
import {readRoutes,resolveRoute,CHANNEL_CATALOG,SETUP_GROUPS,routeName} from './channel-routing.ts';
import {describeKill} from './killfeed.ts';
import {randomInt,randomUUID} from 'node:crypto';
import {registrationSettings,quickChatAction,emoteLabel,safeSay} from '../../core/participation.ts';
import {initialState,stepEngine,restorePlayers,respawnPlayer,log,renderVariables} from '../../core/engine.ts';
import type {Adapter} from '../../core/engine.ts';
import type {Definition,EngineState,WorkflowNode,Player} from '../../core/types.ts';
import {commands,parsePosition} from '../../core/commands.ts';
import {validateDefinition} from '../../core/validation.ts';
import {SerialQueue,safeAdmin} from './guards.ts';
import {connectRce} from './rce.ts';
const botId=process.env.BOT_ID!,epoch=process.env.LEASE_EPOCH!,workerToken=process.env.WORKER_TOKEN!,supervisor=process.env.SUPERVISOR_INTERNAL_URL!;
if(!botId||!epoch||!workerToken||!supervisor)throw new Error('Runtime identity is not configured.');
async function call(path:string,data:Record<string,unknown>={}){const response=await fetch(supervisor+'/v1/runtime/'+path,{method:'POST',headers:{Authorization:'Bearer '+workerToken,'Content-Type':'application/json'},body:JSON.stringify({botId,epoch,...data}),signal:AbortSignal.timeout(25000)});if(!response.ok)throw new Error('Runtime persistence or authorization failed.');return response.json() as Promise<any>;}
let boot:any;for(let i=0;i<10;i++){try{boot=await call('bootstrap');break;}catch{await new Promise(r=>setTimeout(r,1000));}}if(!boot)throw new Error('Runtime bootstrap unavailable.');
const config=boot.config;let channelRoutes=readRoutes(config.channels);let snapshot=boot.snapshot,revision:number=boot.revision;
let current:{definition:Definition;engine:EngineState;channelId:string;eventId:string;version:number}|null=boot.state;
const checkpointQueue=new SerialQueue();let quitting=false,engineRunning=false,paused=false,rconConnected=false;
const discordModule='discord.js';const discord=await import(discordModule);
const client=new discord.Client({intents:[discord.GatewayIntentBits.Guilds],allowedMentions:{parse:[]}});
const rce=await connectRce({...config,password:boot.secrets.password},async()=>{await call('rate');});
let verifiedInfo=await rce.info();rconConnected=true;
const audit=async(type:string,detail:string)=>call('audit',{type,detail:detail.slice(0,400)});
async function checkpoint(s:EngineState){if(!current)throw new Error('No event context.');const serialized=structuredClone({...current,engine:s});await checkpointQueue.run(async()=>{const r=await call('checkpoint',{revision,state:serialized});revision=r.revision;});}
function expectedKit(player:Player,kit:string){let handler:(data:any)=>void;let timer:ReturnType<typeof setTimeout>;const promise=new Promise<void>((resolve,reject)=>{handler=(data:any)=>{if(data.server.identifier===config.id&&data.player?.ign===player.name&&data.kit===kit){clearTimeout(timer);rce.manager.off('kitSpawn',handler);resolve();}};rce.manager.on('kitSpawn',handler);timer=setTimeout(()=>{rce.manager.off('kitSpawn',handler);reject(new Error('Kit delivery acknowledgement missing. Do not retry automatically.'));},12000);});void promise.catch(()=>{});return {promise,cancel(){clearTimeout(timer);rce.manager.off('kitSpawn',handler);}};}
function eventEmbed(d:Definition,s:EngineState,scope:EmbedScope='event-announcement'){return {title:renderVariables(d.embed.title,d,s).slice(0,256),description:renderVariables(d.embed.description,d,s).slice(0,4000),color:parseInt(d.embed.color.slice(1),16),footer:{text:renderVariables(d.embed.footer,d,s).slice(0,512)},...discordMedia(snapshot.bot.config.embedMedia,scope,d.embed)};}
function eventFailure(err:unknown){const e=err as any;const code=Number(e?.code);if(code===50013)return 'Discord: missing permissions (View Channel, Send Messages, Embed Links).';if(code===50001||code===10003)return 'Discord: channel inaccessible or not found.';if(code===50035)return 'Discord rejected the announcement format.';const message=err instanceof Error?err.message:'';if(/missing channel permissions|event channel|registration closed without participants|runtime persistence|checkpoint/i.test(message))return message.slice(0,240);return 'Event operation failed; inspect the saved checkpoint before retrying.';}
async function eventChannel(id:string){let channel:any;try{channel=await client.channels.fetch(id);}catch(e){throw new Error(eventFailure(e));}if(!channel?.isTextBased()||typeof channel.send!=='function'||channel.guildId!==config.guildId)throw new Error('Event channel is unavailable or is not in the configured Discord server.');const permissions=channel.permissionsFor(client.user);if(!permissions?.has([discord.PermissionFlagsBits.ViewChannel,discord.PermissionFlagsBits.SendMessages,discord.PermissionFlagsBits.EmbedLinks]))throw new Error('Missing channel permissions: View Channel, Send Messages and Embed Links.');return channel;}
const adapter:Adapter={
 checkpoint,
 async readPosition(p){const raw=await rce.request(commands.position(p.name));return parsePosition(raw,p.name);},
 async command(cmd,ctx){
  if(quitting&&ctx.kind!=='players.return'&&ctx.kind!=='event.end')throw new Error('Shutdown requested.');
  if(!rconConnected)throw new Error('RCON disconnected.');
  if(ctx.kind==='kits.give'&&ctx.player){const kit=ctx.kit||current!.definition.nodes.find(n=>n.id===current!.engine.current)!.params.kit as string;const receipt=expectedKit(ctx.player,kit);try{const raw=await rce.request(cmd);if(/\b(error|invalid|unknown|not found)\b/i.test(raw)){receipt.cancel();throw new Error('Server rejected the kit operation.');}await receipt.promise;}catch(e){receipt.cancel();throw e;}return;}
  const raw=await rce.request(cmd);if(/\b(error|invalid|unknown command|not found|denied|failed)\b/i.test(raw))throw new Error('Server rejected the requested operation.');
  if(ctx.player&&['players.teleport','players.return'].includes(ctx.kind)){
   const pos=parsePosition(await rce.request(commands.position(ctx.player.name)),ctx.player.name);const expected=ctx.destination||(ctx.kind==='players.return'?(ctx.player.exitGate||ctx.player.origin!):(ctx.player.entryGate||current!.definition.arena));
   if(Math.hypot(pos.x-expected.x,pos.y-expected.y,pos.z-expected.z)>5)throw new Error('Teleport destination could not be confirmed.');return;
  }
  // Mutations without a verified target-server acknowledgement fail closed. No optimistic success.
  if(ctx.kind==='entity.spawn'&&!/^spawned\b/i.test(raw.trim()))throw new Error('Spawn acknowledgement format requires target-server verification. Entity may exist; do not repeat.');
  if(ctx.kind==='zone.create'&&!/\b(created|added)\b/i.test(raw))throw new Error('Zone creation acknowledgement is ambiguous. Reconcile the event-owned zone.');
  if(ctx.kind==='event.end'&&!/\b(deleted|removed)\b/i.test(raw))throw new Error('Zone deletion acknowledgement is ambiguous.');
 },
 async announce(message,d,s){if(!current?.channelId)throw new Error('No event channel.');const channel=await client.channels.fetch(current.channelId);if(!channel?.isTextBased())throw new Error('Event channel is unavailable.');const permissions=channel.permissionsFor(client.user);if(!permissions?.has([discord.PermissionFlagsBits.ViewChannel,discord.PermissionFlagsBits.SendMessages,discord.PermissionFlagsBits.EmbedLinks]))throw new Error('Missing channel permissions.');await channel.send({content:message.slice(0,1900),allowedMentions:{parse:[]},embeds:[eventEmbed(d,s,d.nodes.find(n=>n.id===s.current)?.kind==='winner.announce'?'event-winner':'event-announcement')]});},
 async wait(seconds,s,node){
  const registration=node.kind==='registration.open';const opts=registrationSettings(node.params);let message:any;
  const game=registration&&opts.mode!=='discord';const discordJoin=opts.mode!=='game';const sayText=(text:string)=>renderVariables(text,current!.definition,s).replaceAll('{join.emote}',emoteLabel(opts.joinEmote)).replaceAll('{leave.emote}',emoteLabel(opts.leaveEmote));
  async function gameSay(text:string){const response=await rce.request(safeSay(sayText(text)));if(/\b(error|invalid|unknown command|denied|failed)\b/i.test(response))throw new Error('In-game announcement rejected.');}
  const registrationPayload=(remaining:number,closed=false)=>{
   const d=current!.definition;const embed=eventEmbed(d,s,closed?'event-registration-closed':'event-registration-open');
   const names=s.players.slice(0,20).map(p=>p.name.replace(/[@`*_~]/g,'')).join(', ').slice(0,950);
   return {content:closed?(s.players.length?'🔒 Registration closed. Preparing participants.':'Registration closed — no participants. Event cancelled.'):('Registration open • '+remaining+'s remaining. '+(discordJoin?'Use /link before joining. ':'')+(game?'In Rust SERVER Quick Chat: '+emoteLabel(opts.joinEmote)+' to join / '+emoteLabel(opts.leaveEmote)+' to leave.':'')),embeds:[{...embed,fields:[{name:'Participants',value:s.players.length+'/'+d.maxPlayers,inline:true},{name:'Registration',value:closed?'Closed':paused?'Paused':remaining+' seconds',inline:true},{name:'Roster',value:names||'Nobody joined yet.'}]}],components:closed||!discordJoin?[]:[new discord.ActionRowBuilder().addComponents(new discord.ButtonBuilder().setCustomId('join:'+s.runId).setLabel('Join event').setStyle(discord.ButtonStyle.Success),new discord.ButtonBuilder().setCustomId('leave:'+s.runId).setLabel('Leave').setStyle(discord.ButtonStyle.Secondary))],allowedMentions:{parse:[]}};
  };
  if(registration){const channel=await eventChannel(current!.channelId);try{if(game)await gameSay(opts.sayMessage);message=await channel.send(registrationPayload(seconds));}catch(e){s.registrationOpen=false;throw new Error(eventFailure(e));}}
  try{
   for(let i=0;i<seconds;i++){if(quitting)throw new Error('Shutdown during wait.');while(paused&&!quitting)await new Promise(r=>setTimeout(r,1000));if(quitting)throw new Error('Shutdown during wait.');await new Promise(r=>setTimeout(r,1000));s.now++;if(i%10===0)await checkpoint(s);if(message&&((i+1)%10===0||seconds-i-1===5))await message.edit(registrationPayload(seconds-i-1)).catch(()=>{});}
  }finally{if(registration){s.registrationOpen=false;if(message)await message.edit(registrationPayload(0,true)).catch(()=>{});if(game)await gameSay(opts.sayClosedMessage).catch(()=>audit('event.say_failed','In-game registration close announcement failed.'));}}
  if(registration&&!s.players.length)throw new Error('Registration closed without participants; no Rust actions were executed.');
  if(registration){const teams=current!.definition.spatial?.teams||1;s.players.forEach((p,i)=>{p.team=i%teams;});await checkpoint(s);}
 }
};
async function restoreEligible(){if(!current)return;const node:WorkflowNode={id:'recovery',kind:'players.return',label:'Recovery',position:{x:0,y:0},params:{}};await restorePlayers(adapter,current.engine,node);}
async function run(){if(engineRunning||!current)return;engineRunning=true;try{while(current&&current.engine.current&&!quitting&&!['NEEDS_REVIEW','COMPLETED','CANCELLED'].includes(current.engine.status)){while(paused&&!quitting)await new Promise(r=>setTimeout(r,1000));await stepEngine(current.definition,current.engine,adapter);}if(current?.engine.status==='NEEDS_REVIEW'){await restoreEligible();const detail=current.engine.logs.filter(l=>l.level==='error').at(-1);const reason=detail?eventFailure(new Error(detail.message)):'Interrupted event requires reconciliation.';await audit('event.needs_review',reason+' Saved return records retained.');}else if(current?.engine.status==='COMPLETED'){await audit('event.completed','Workflow finished.');const state=current.engine;const pending=state.players.filter(p=>p.pendingReturn).length;const returned=state.players.filter(p=>p.returned).length;try{const channel=await eventChannel(current.channelId);await channel.send({embeds:[{...discordMedia(snapshot.bot.config.embedMedia,'event-summary',current.definition.embed),title:'Event completed · '+current.definition.name,description:'Workflow finished. '+(state.winner?'Winner: '+state.winner:'No automatic individual winner recorded.'),color:0x22c55e,fields:[{name:'Participants',value:String(state.players.length),inline:true},{name:'Returned',value:String(returned),inline:true},{name:'Pending recovery',value:String(pending),inline:true},{name:'Event-owned zones remaining',value:String(state.zones.length),inline:true},{name:'Spawned entities recorded',value:String(state.entities.length)+' (despawn not verified)',inline:true}]}],allowedMentions:{parse:[]}});}catch{await audit('event.discord_summary_failed','Event completed; final Discord summary could not be delivered.').catch(()=>{});}}}catch(e){if(current){current.engine.status='NEEDS_REVIEW';current.engine.registrationOpen=false;log(current.engine,current.engine.current||'runtime',eventFailure(e),'error');await checkpoint(current.engine).catch(()=>{});await audit('event.needs_review',eventFailure(e)).catch(()=>{});}}finally{engineRunning=false;}}
const challenges=new Map<string,{discordId:string;code:string;expires:number}>();
const quickCooldown=new Map<string,number>();let quickRun='';
rce.manager.on('quickChat',async(data:any)=>{
 const ctx=current;if(!ctx||!ctx.engine.registrationOpen||paused||quitting||!snapshot.modules.registration||data.server?.identifier!==config.id)return;
 const s=ctx.engine;const node=ctx.definition.nodes.find(n=>n.id===s.current&&n.kind==='registration.open');if(!node)return;
 const action=quickChatAction(node.params,data);const name=data.player?.ign;if(!action||typeof name!=='string'||!name||name.length>64)return;
 const key=name.toLowerCase();if(quickRun!==s.runId){quickRun=s.runId;quickCooldown.clear();}const prev=quickCooldown.get(key)||0;if(Date.now()-prev<3000)return;if(quickCooldown.size>=1000&&!quickCooldown.has(key))return;quickCooldown.set(key,Date.now());
 try{
  if(action==='leave'){const p=s.players.find(p=>p.name.toLowerCase()===key);if(p&&current===ctx&&s.registrationOpen){s.players=s.players.filter(q=>q!==p);await checkpoint(s);await audit('player.game_left','Participant withdrew using Quick Chat.');}return;}
  if(s.players.some(p=>p.name.toLowerCase()===key)||s.players.length>=ctx.definition.maxPlayers)return;
  commands.position(name);const links=await call('links');const linked=links.links.find((x:any)=>String(x.ign).toLowerCase()===key);
  const p:Player={id:linked?.discord_id||'game:'+key,name,team:0,position:{x:0,y:0,z:0},online:true,alive:true,score:0,returned:false,pendingReturn:false,trail:[]};
  p.position=await adapter.readPosition(p);
  if(current!==ctx||!s.registrationOpen||paused||quitting||s.players.length>=ctx.definition.maxPlayers||s.players.some(q=>q.id===p.id||q.name.toLowerCase()===key))return;
  p.team=s.players.length%(ctx.definition.spatial?.teams||1);s.players.push(p);await checkpoint(s);await audit('player.game_joined','Participant joined using authenticated server Quick Chat.');
 }catch{await audit('player.game_join_failed','Quick Chat registration failed; player position or persistence could not be confirmed.').catch(()=>{});}
});
rce.manager.on('noteEdit',async(data:any)=>{const pending=challenges.get(data.player?.ign);if(!pending||pending.expires<Date.now()||data.newContent?.trim()!==pending.code)return;try{await call('link',{discordId:pending.discordId,ign:data.player.ign});challenges.delete(data.player.ign);await audit('player.linked','An in-game identity challenge was verified.');}catch{}});
let lastKillfeedError=0;
rce.manager.on('playerKill',async(data:any)=>{
 const kill=describeKill(data,config.id);if(!kill)return;
 if(snapshot.entitled&&!quitting&&kill.kind==='Player'&&!kill.suicide)await call('pvp-kill',{eventId:randomUUID(),killer:kill.killer,victim:kill.victim}).catch(()=>audit('leaderboard.record_failed','A PvP observation could not be saved.').catch(()=>{}));
 // Persist eliminations independently from Discord delivery, even if the feed is disabled.
 const p=current?.engine.players.find(p=>p.name===kill.victim);
 if(p&&p.alive&&current){p.alive=false;log(current.engine,'game-event',p.name+' eliminated.');try{await checkpoint(current.engine);}catch{paused=true;}}
 if(!snapshot.entitled||quitting||!snapshot.modules.killfeed)return;
 const id=resolveRoute(channelRoutes,'kills',snapshot.bot.config.killfeedChannelId||snapshot.bot.config.announcementChannelId);if(!id)return;
 try{
  const channel=await eventChannel(id);
  await channel.send({embeds:[{...discordMedia(snapshot.bot.config.embedMedia,kill.suicide?'kill-suicide':kill.kind==='Player'?'kill-pvp':kill.kind==='Npc'?'kill-npc':kill.kind==='Entity'?'kill-entity':'kill-natural'),title:kill.title,description:kill.description,color:kill.color,footer:{text:'WIPESIDE · '+String(snapshot.bot.config.serverName||config.id).slice(0,100)},timestamp:new Date().toISOString()}],allowedMentions:{parse:[]}});
 }catch(e){if(Date.now()-lastKillfeedError>60000){lastKillfeedError=Date.now();await audit('killfeed.delivery_failed',eventFailure(e)).catch(()=>{});}}
});
rce.manager.on('playerSuicide',async(data:any)=>{const p=current?.engine.players.find(p=>p.name===data.player?.ign);if(!p||!p.alive)return;p.alive=false;await checkpoint(current!.engine).catch(()=>{paused=true;});});
rce.manager.on('playerLeft',async(data:any)=>{const p=current?.engine.players.find(p=>p.name===data.player?.ign);if(p){p.online=false;await checkpoint(current!.engine).catch(()=>{paused=true;});}});
for(const event of ['playerJoined','playerRespawned'])rce.manager.on(event,async(data:any)=>{const p=current?.engine.players.find(p=>p.name===data.player?.ign);if(!p)return;p.online=true;if(event==='playerRespawned'){const active=current?.engine.status==='RUNNING'&&!!p.origin&&!p.returned;if(!active||current?.definition.spatial?.respawn.mode!=='disabled'&&current?.definition.spatial?.respawn.mode!==undefined){p.alive=true;if(active&&current)await respawnPlayer(current.definition,current.engine,adapter,p).catch(()=>{paused=true;});}else if(current?.definition.spatial?.spectatorOnRespawn){await respawnPlayer(current.definition,current.engine,adapter,p).catch(()=>{paused=true;});}}if(p.pendingReturn&&['NEEDS_REVIEW','CANCELLED','COMPLETED'].includes(current!.engine.status))await restoreEligible().catch(()=>{});});
rce.manager.on('error',()=>{rconConnected=false;});
let channelSetupBusy=false;
async function saveRoute(type:string,id:string,actor:string){const channel=await eventChannel(id);if(SETUP_GROUPS.find(g=>g.name.endsWith('STAFF'))?.keys.some(k=>k===type)&&channel.permissionsFor(channel.guild.roles.everyone)?.has(discord.PermissionFlagsBits.ViewChannel))throw Error('Staff channel must be private.');const result=await call('channel',{actor,guildId:config.guildId,type,channelId:id});channelRoutes=readRoutes(result.channels);}
async function createChannels(actor:string){
 if(channelSetupBusy)throw Error('A channel setup is already running.');channelSetupBusy=true;
 const results:{type:string;status:string}[]=[];
 try{
  if(!snapshot.entitled||actor!==snapshot.ownerDiscordId||quitting)throw Error('Owner and active hosting required.');
  const guild=await client.guilds.fetch(config.guildId);const me=await guild.members.fetchMe();
  if(!me.permissions.has(discord.PermissionFlagsBits.ManageChannels))throw Error('Bot needs Manage Channels.');
  const channels=await guild.channels.fetch();
  for(const group of SETUP_GROUPS){const staff=group.name.endsWith('STAFF');let category:any;
   for(const key of group.keys){try{
    if(quitting)throw Error('Bot stopping');
    const saved=channelRoutes[key];
    if(saved){const existing=await eventChannel(saved);if(staff&&existing.permissionsFor(guild.roles.everyone)?.has(discord.PermissionFlagsBits.ViewChannel))throw Error('Staff channel is public');results.push({type:key,status:'kept'});continue;}
    if(!category){const matches=channels.filter((c:any)=>c?.type===discord.ChannelType.GuildCategory&&c.name===group.name);if(matches.size>1)throw Error('Ambiguous category');category=matches.first();if(!category){category=await guild.channels.create({name:group.name,type:discord.ChannelType.GuildCategory,reason:'Wipeside setup',...(staff?{permissionOverwrites:[{id:guild.id,deny:[discord.PermissionFlagsBits.ViewChannel]},{id:me.id,allow:[discord.PermissionFlagsBits.ViewChannel,discord.PermissionFlagsBits.SendMessages,discord.PermissionFlagsBits.EmbedLinks]}]}:{})});channels.set(category.id,category);}
    }
    if(staff&&category.permissionsFor(guild.roles.everyone)?.has(discord.PermissionFlagsBits.ViewChannel))throw Error('Existing staff category is public');
    const matches=channels.filter((c:any)=>c?.type===discord.ChannelType.GuildText&&c.parentId===category.id&&c.name===routeName(key));if(matches.size>1)throw Error('Ambiguous channel');let channel:any=matches.first();const reused=!!channel;
    if(!channel){channel=await guild.channels.create({name:routeName(key),type:discord.ChannelType.GuildText,parent:category.id,topic:'WIPESIDE module: '+key,reason:'Confirmed Wipeside setup',...(staff?{permissionOverwrites:[{id:guild.id,deny:[discord.PermissionFlagsBits.ViewChannel]},{id:me.id,allow:[discord.PermissionFlagsBits.ViewChannel,discord.PermissionFlagsBits.SendMessages,discord.PermissionFlagsBits.EmbedLinks]}]}:{})});channels.set(channel.id,channel);}
    if(staff&&channel.permissionsFor(guild.roles.everyone)?.has(discord.PermissionFlagsBits.ViewChannel))throw Error('Staff channel is public');
    await saveRoute(key,channel.id,actor);results.push({type:key,status:reused?'reused':'created'});
   }catch{results.push({type:key,status:'needs review'});}}
  }
  return results;
 }finally{channelSetupBusy=false;}
}
async function processChannelJob(job:any){if(channelSetupBusy||!job||!['PENDING','RUNNING'].includes(job.status))return;
 await call('channel-job',{jobId:job.id,status:'RUNNING'});
 try{let result;if(job.kind==='setup')result=await createChannels(job.actor);else{await saveRoute(job.type,job.channelId,job.actor);result=[{type:job.type,status:'saved'}];}
 await call('channel-job',{jobId:job.id,status:result.some(x=>x.status==='needs review')?'PARTIAL':'COMPLETED',result});
 }catch{await call('channel-job',{jobId:job.id,status:'FAILED',result:[]}).catch(()=>{});}
}
let leaderboardBusy=false,lastLeaderboard=0;
async function updateLeaderboard(){
 if(leaderboardBusy||quitting||!snapshot.entitled||!channelRoutes.leaderboard)return false;
 leaderboardBusy=true;lastLeaderboard=Date.now();try{
  const channelId=channelRoutes.leaderboard,channel=await eventChannel(channelId);
  const data=await call('leaderboard',{channelId});
  const rows=Array.isArray(data.rows)?data.rows:[];
  const clean=(v:unknown)=>String(v).replace(/[\\`*_~|<>\[\]]/g,m=>'\\'+m).slice(0,90);
  const description=rows.length?rows.map((r:any,i:number)=>'**'+(i+1)+'.** '+clean(r.name)+' — '+Number(r.kills)+' K / '+Number(r.deaths)+' D · K/D '+(Number(r.kills)/Math.max(1,Number(r.deaths))).toFixed(2)).join('\n'):'No PvP kills have been recorded since tracking started.';
  const payload={embeds:[{title:'WIPESIDE · PvP leaderboard',description:description+'\n\nObserved PvP kills and deaths only. Updates every 5 minutes.',color:0xf2ad73,timestamp:new Date().toISOString(),...discordMedia(snapshot.bot.config.embedMedia,'default')}],allowedMentions:{parse:[]}};
  let message:any;if(data.messageId){try{message=await channel.messages.fetch(data.messageId);}catch(e){if(Number((e as any)?.code)!==10008)throw e;}}
  if(message){if(message.author.id!==client.user.id)throw Error('Leaderboard message belongs to a different author.');await message.edit(payload);}else{message=await channel.send(payload);await call('leaderboard-message',{channelId,messageId:message.id});}return true;
 }finally{leaderboardBusy=false;}
}
const leaderboardCommand=new discord.SlashCommandBuilder().setName('leaderboard').setDescription('Refresh the PvP leaderboard').setDefaultMemberPermissions(discord.PermissionFlagsBits.ManageGuild);
const rulesCommand=new discord.SlashCommandBuilder().setName('rules').setDescription('Read the server rules or publish the saved rules panel').addSubcommand((s:any)=>s.setName('view').setDescription('Read your community rules')).addSubcommand((s:any)=>s.setName('publish').setDescription('Owner: publish the saved rules to the configured channel'));
const kitsCommand=new discord.SlashCommandBuilder().setName('kits').setDescription('List actual kits on your Rust server').setDefaultMemberPermissions(discord.PermissionFlagsBits.ManageGuild);
function rulesPayload(){const r=snapshot.bot.config.rulesDraft;if(!r||typeof r.title!=='string'||typeof r.description!=='string'||!r.title.trim()||!r.description.trim())throw Error('Configure and save server rules in Bot Studio first.');const art=discordMedia(snapshot.bot.config.embedMedia,'default');const valid=(url:unknown)=>{if(typeof url!=='string'||url.length>1500)return false;try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};return {embeds:[{...art,title:r.title.slice(0,256),description:r.description.slice(0,4000),color:0xf2ad73,...(valid(r.image)?{image:{url:r.image}}:{}),...(valid(r.thumbnail)?{thumbnail:{url:r.thumbnail}}:{})}],allowedMentions:{parse:[]}};}
const setupCommand=new discord.SlashCommandBuilder().setName('setup').setDescription('Create the Wipeside channel structure').setDefaultMemberPermissions(discord.PermissionFlagsBits.ManageChannels);
const botCommand=new discord.SlashCommandBuilder().setName('bot').setDescription('Hosted bot controls').setDefaultMemberPermissions(discord.PermissionFlagsBits.ManageGuild);
for(const name of ['status','restart','reconnect','panel','modules'])botCommand.addSubcommand((s:any)=>s.setName(name).setDescription(name==='status'?'Show connection status':name+' the hosted bot'));
botCommand.addSubcommand((s:any)=>s.setName('channel').setDescription('Configure a module channel').addStringOption((o:any)=>o.setName('module').setDescription('Choose an active module').setRequired(true).setAutocomplete(true)).addChannelOption((o:any)=>o.setName('channel').setDescription('Select a text channel in this server').setRequired(true).addChannelTypes(discord.ChannelType.GuildText,discord.ChannelType.GuildAnnouncement)));
botCommand.addSubcommand((s:any)=>s.setName('channels').setDescription('Show configured module channels'));
const eventCommand=new discord.SlashCommandBuilder().setName('event').setDescription('Manage community events').setDefaultMemberPermissions(discord.PermissionFlagsBits.ManageGuild);
for(const name of ['list','status','participants','stop','pause','resume'])eventCommand.addSubcommand((s:any)=>s.setName(name).setDescription(name+' event'));
eventCommand.addSubcommand((s:any)=>s.setName('start').setDescription('Start a published event').addStringOption((o:any)=>o.setName('event').setDescription('Search and select a published event by name').setRequired(true).setAutocomplete(true)));
const linkCommand=new discord.SlashCommandBuilder().setName('link').setDescription('Verify your in-game identity').addStringOption((o:any)=>o.setName('name').setDescription('Your exact in-game name').setRequired(true));
async function authorized(i:any){if(!safeAdmin(i.user.id,i.guildId,{guildId:config.guildId,ownerDiscordId:snapshot.ownerDiscordId,staffIds:snapshot.bot.config.staffIds||[]}))throw new Error('Workspace owner or authorized staff required.');const member=await i.guild.members.fetch(i.user.id);if(!member.permissions.has(discord.PermissionFlagsBits.ManageGuild)&&i.user.id!==snapshot.ownerDiscordId)throw new Error('Manage Server permission required.');}
function publishedChoices(query=''){
 const q=query.trim().toLowerCase();const events=Array.isArray(snapshot.events)?snapshot.events:[];
 return events.filter((e:any)=>!q||String(e.definition.name).toLowerCase().includes(q)).slice(0,25).map((e:any)=>{
 const same=events.filter((v:any)=>v.definition.name===e.definition.name&&v.version===e.version).length;
 return {name:(e.definition.name+' · v'+e.version+(same>1?' · '+e.id.slice(0,6):'')).slice(0,100),value:e.id};
 });
}
async function startPublished(i:any,id:string){
 if(!snapshot.entitled)throw new Error('An active hosting entitlement is required.');
 if(current&&(engineRunning||current.engine.players.some(p=>p.pendingReturn)||current.engine.status==='NEEDS_REVIEW'&&current.engine.zones.length))throw new Error('Finish or reconcile the active event and pending returns/zones first.');
 const e=snapshot.events.find((e:any)=>e.id===id);if(!e)throw new Error('Published event not found. Select a published event.');
 const errors=validateDefinition(e.definition);if(errors.length)throw new Error('Published workflow is invalid.');
 if(e.definition.nodes.some((n:WorkflowNode)=>n.kind==='entity.spawn')&&!snapshot.modules.entitySpawning)throw new Error('Enable entity spawning before starting this workflow.');
 const channelId=resolveRoute(channelRoutes,'events',snapshot.bot.config.announcementChannelId)||i.channelId;await eventChannel(channelId);
 current={definition:structuredClone(e.definition),engine:initialState(e.definition,'live'),channelId,eventId:e.id,version:e.version};
 await checkpoint(current.engine);await i.editReply({content:'Event accepted. Opening registration in <#'+channelId+'> using the published version.',components:[]});
 const runId=current.engine.runId;void run().then(async()=>{if(current?.engine.runId===runId&&current.engine.status==='NEEDS_REVIEW'){const last=current.engine.logs.filter(l=>l.level==='error').at(-1);await i.followUp({content:'Event stopped: '+(last?eventFailure(new Error(last.message)):'Manual reconciliation required.'),flags:64}).catch(()=>{});}});
}
client.on('interactionCreate',async(i:any)=>{if(!i.inGuild()||i.guildId!==config.guildId)return;try{
 if(i.isAutocomplete()){
  if(i.commandName==='bot'){if(i.user.id!==snapshot.ownerDiscordId){await i.respond([]);return;}const q=String(i.options.getFocused()||'').toLowerCase();await i.respond(CHANNEL_CATALOG.filter(([k,n])=>(k+' '+n).toLowerCase().includes(q)).slice(0,25).map(([value,name])=>({name,value})));return;}
  if(i.commandName!=='event')return;
  if(!safeAdmin(i.user.id,i.guildId,{guildId:config.guildId,ownerDiscordId:snapshot.ownerDiscordId,staffIds:snapshot.bot.config.staffIds||[]})){await i.respond([]);return;}
  await i.respond(publishedChoices(String(i.options.getFocused()||'')));return;
 }
 if(i.isStringSelectMenu()&&i.customId.startsWith('event-pick:')){
  if(i.customId.split(':')[1]!==i.user.id)throw new Error('This event menu belongs to another administrator.');await authorized(i);
  const selected=snapshot.events.find((e:any)=>e.id===i.values[0]);if(!selected)throw new Error('Published event not found.');
  await i.update({content:'Start **'+selected.definition.name+'** (v'+selected.version+') in the configured announcement channel?',components:[new discord.ActionRowBuilder().addComponents(new discord.ButtonBuilder().setCustomId('event-launch:'+i.user.id+':'+selected.id).setLabel('Start event').setStyle(discord.ButtonStyle.Success))]});return;
 }
 if(i.isButton()){
  if(i.customId.startsWith('ws-setup:')){await authorized(i);if(i.user.id!==snapshot.ownerDiscordId||i.customId.split(':')[1]!==i.user.id)throw Error('Owner confirmation required.');await i.deferUpdate();await i.editReply({content:'Creating channel structure…',components:[]});try{const rows=await createChannels(i.user.id);await i.editReply({content:rows.map(x=>x.type+': '+x.status).join('\n').slice(0,1900),components:[]});}catch{await i.editReply({content:'Setup could not complete. Check bot Manage Channels permission and active hosting.',components:[]});}return;}
  if(i.customId.startsWith('event-launch:')){const [,actor,id]=i.customId.split(':');if(actor!==i.user.id)throw new Error('This confirmation belongs to another administrator.');await authorized(i);await i.deferUpdate();await startPublished(i,id);return;}
  if(i.customId.startsWith('module:')){await authorized(i);await i.deferReply({flags:64});const module=i.customId.slice(7);if(!['registration','accountLinking','killfeed','positionTracking','entitySpawning'].includes(module))throw new Error('Unknown module.');const result=await call('module',{actor:i.user.id,guildId:i.guildId,module,enabled:!snapshot.modules[module]});snapshot.modules=result.modules;await i.editReply(module+' is now '+(snapshot.modules[module]?'enabled':'disabled')+'.');return;}
 if(i.customId.startsWith('confirm-restart:')){await authorized(i);if(i.customId.split(':')[1]!==i.user.id)throw new Error('This confirmation belongs to another administrator.');await i.update({content:'Restart accepted. The supervisor owns the lifecycle operation.',components:[]});await call('action',{actor:i.user.id,guildId:i.guildId,action:'restart'});return;}
  const [kind,runId]=i.customId.split(':');if(!['join','leave'].includes(kind))return;await i.deferReply({flags:64});if(!current||current.engine.runId!==runId||!current.engine.registrationOpen||!snapshot.modules.registration)throw new Error('Registration is closed.');const s=current.engine;const registrationNode=current.definition.nodes.find(n=>n.id===s.current&&n.kind==='registration.open');if(!registrationNode||registrationSettings(registrationNode.params).mode==='game')throw new Error('This event uses in-game SERVER Quick Chat registration.');
  if(kind==='leave'){const links=await call('links');const linked=links.links.find((x:any)=>x.discord_id===i.user.id);if(!s.registrationOpen||current?.engine!==s)throw new Error('Registration is closed.');s.players=s.players.filter(p=>p.id!==i.user.id&&(!linked||p.name.toLowerCase()!==String(linked.ign).toLowerCase()));await checkpoint(s);await i.editReply('You left the event.');return;}
  if(s.players.some(p=>p.id===i.user.id)){await i.editReply('You are already registered.');return;}if(s.players.length>=current.definition.maxPlayers)throw new Error('This event is full.');const links=await call('links');const linked=links.links.find((x:any)=>x.discord_id===i.user.id);if(!linked)throw new Error('Use /link to verify your in-game identity first.');
  const p:Player={id:i.user.id,name:linked.ign,team:s.players.length%(current.definition.spatial?.teams||2),position:{x:0,y:0,z:0},online:true,alive:true,score:0,returned:false,pendingReturn:false,trail:[]};try{p.position=await adapter.readPosition(p);}catch{let count:number|null=null;try{count=(await rce.info()).Players;}catch{}await audit('player.join_position_failed',count===null?'Position could not be verified; server count unavailable.':`Position could not be verified; server reports ${count} online player(s).`);throw new Error(count===0?'Your identity is linked, but Rust reports 0 online players. Connect to the Rust server before joining.':'Your identity is linked, but the bot could not confirm your Rust position. Check your exact in-game username and server; no teleport was attempted.');}if(!s.registrationOpen||current?.engine!==s)throw new Error('Registration closed during verification.');if(s.players.some(q=>q.id===p.id||q.name.toLowerCase()===p.name.toLowerCase()))throw new Error('This player is already registered.');if(s.players.length>=current.definition.maxPlayers)throw new Error('This event is full.');p.team=s.players.length%(current.definition.spatial?.teams||1);s.players.push(p);await checkpoint(s);await i.editReply(`Joined ${current.definition.name}. Your return position will be saved before teleport.`);return;
 }
 if(!i.isChatInputCommand())return;await i.deferReply({flags:64});
 if(i.commandName==='rules'){if(!snapshot.entitled||quitting)throw Error('Active hosting required.');const action=i.options.getSubcommand();if(action==='view'){await i.editReply(rulesPayload());return;}await authorized(i);if(i.user.id!==snapshot.ownerDiscordId)throw Error('Owner required.');const id=snapshot.bot.config.rulesDraft?.channelId;if(typeof id!=='string'||!/^\d{17,20}$/.test(id)){await i.editReply('Set a valid rules channel ID in Bot Studio first.');return;}const channel=await eventChannel(id);await channel.send(rulesPayload());await i.editReply('Rules published to <#'+id+'>.');return;}
 if(i.commandName==='kits'){await authorized(i);if(!snapshot.entitled||!rconConnected||quitting)throw Error('Active RCON required.');const response=await rce.request('kit list');const raw=String(response||'').replace(/[`\x00-\x08\x0b-\x1f\x7f]/g,' ').trim();await i.editReply({content:raw?'Rust kit list (server response):\n'+raw.slice(0,1750):'The server did not return a kit list.',allowedMentions:{parse:[]}});return;}
 if(i.commandName==='link'){if(!snapshot.modules.accountLinking)throw new Error('Account linking is disabled.');const name=i.options.getString('name',true).trim();commands.position(name);
  // The platform owner may explicitly nominate their own Rust identity, even while offline.
  // This is an administrative self-link, not a proof of ownership for other users.
  if(i.user.id===snapshot.ownerDiscordId){await authorized(i);await call('link',{discordId:i.user.id,ign:name});await audit('player.owner_self_linked','Platform owner saved a self-declared Rust identity without a note challenge.');await i.editReply('Linked to '+name+'. No note required and you can link while offline. Join an event when your Rust character is connected; the bot must confirm your position before any teleport.');return;}
  if(challenges.has(name)&&challenges.get(name)!.expires>Date.now())throw new Error('A verification challenge already exists for this name.');const code='RCE-'+randomInt(100000,999999);challenges.set(name,{discordId:i.user.id,code,expires:Date.now()+300000});await i.editReply(`Edit an in-game note to contain exactly: ${code}\nThe challenge expires in five minutes. No Discord user token is needed.`);return;}
 await authorized(i);if(i.commandName==='leaderboard'){const updated=await updateLeaderboard();await i.editReply(updated?'Leaderboard updated.':'Configure the leaderboard channel first or wait for its current refresh.');return;}if(i.commandName==='setup'){if(i.user.id!==snapshot.ownerDiscordId)throw Error('Owner required.');await i.editReply({content:'Create or reuse '+CHANNEL_CATALOG.length+' channels in WIPESIDE categories? Existing channels are not deleted or moved. Planned modules will not be activated.',components:[new discord.ActionRowBuilder().addComponents(new discord.ButtonBuilder().setCustomId('ws-setup:'+i.user.id).setLabel('Create channels').setStyle(discord.ButtonStyle.Success))]});return;}const sub=i.options.getSubcommand();
 if(i.commandName==='bot'){
  if(sub==='channels'){const kill=resolveRoute(channelRoutes,'kills',snapshot.bot.config.killfeedChannelId||snapshot.bot.config.announcementChannelId);const events=resolveRoute(channelRoutes,'events',snapshot.bot.config.announcementChannelId);await i.editReply({embeds:[{...discordMedia(snapshot.bot.config.embedMedia,'bot-channels'),title:'WIPESIDE · Channel routing',description:'Killfeed: '+(kill?'<#'+kill+'>':'Not configured')+'\nEvents: '+(events?'<#'+events+'>':'Command channel')+'\n\nUse /bot channel to change a destination.',color:0xf2ad73}],allowedMentions:{parse:[]}});return;}
  if(sub==='channel'){if(i.user.id!==snapshot.ownerDiscordId)throw new Error('Only the workspace owner can change channel routing.');const type=i.options.getString('module',true);const channel=i.options.getChannel('channel',true);await eventChannel(channel.id);const result=await call('channel',{actor:i.user.id,guildId:i.guildId,type,channelId:channel.id});channelRoutes=readRoutes(result.channels);await i.editReply({content:'Saved '+type+' → <#'+channel.id+'> for this bot.',allowedMentions:{parse:[]}});return;}
  if(sub==='modules'){await i.editReply({content:'Modules are saved in your workspace. Toggle a module below.',components:[new discord.ActionRowBuilder().addComponents(...['registration','accountLinking','killfeed','positionTracking','entitySpawning'].map(module=>new discord.ButtonBuilder().setCustomId('module:'+module).setLabel(module+': '+(snapshot.modules[module]?'ON':'OFF')).setStyle(snapshot.modules[module]?discord.ButtonStyle.Success:discord.ButtonStyle.Secondary)))]});return;}
  if(sub==='status'||sub==='panel'){await i.editReply({embeds:[{...discordMedia(snapshot.bot.config.embedMedia,'bot-status'),title:'WIPESIDE',description:`Discord: ${client.isReady()?'CONNECTED':'DISCONNECTED'}\nRCON: ${rconConnected?'CONNECTED':'DISCONNECTED'}\nEvent: ${current?.engine.status||'None'}\nPlayers: ${verifiedInfo.Players}/${verifiedInfo.MaxPlayers}`,color:0xb79af7}]});return;}
  if(sub==='restart'){await i.editReply({content:'Restart this hosted bot? In-flight actions will require reconciliation.',components:[new discord.ActionRowBuilder().addComponents(new discord.ButtonBuilder().setCustomId('confirm-restart:'+i.user.id).setLabel('Confirm restart').setStyle(discord.ButtonStyle.Danger))]});return;}
  if(sub==='reconnect'){await call('action',{actor:i.user.id,guildId:i.guildId,action:'reconnect'});await i.editReply('Reconnect requested through the supervisor.');return;}
 }
 if(i.commandName==='event'){
  if(sub==='list'){const options=publishedChoices();if(!options.length){await i.editReply('No published events. Publish a successful simulated version in Event Studio.');return;}await i.editReply({content:'Choose a published event below. You can also use /event start and search by name.'+(snapshot.events.length>25?' Showing the first 25; use autocomplete for the rest.':''),components:[new discord.ActionRowBuilder().addComponents(new discord.StringSelectMenuBuilder().setCustomId('event-pick:'+i.user.id).setPlaceholder('Select an event').addOptions(options.map((o:any)=>({label:o.name,value:o.value}))))]});return;}
  if(sub==='status'||sub==='participants'){const last=current?.engine.logs.filter(l=>l.level==='error').at(-1);await i.editReply(current?(`${current.definition.name} · ${current.engine.status}\n`+(last?'Last error: '+eventFailure(new Error(last.message))+'\n':'')+current.engine.players.map(p=>`${p.name}: ${p.returned?'returned':p.pendingReturn?'return pending':p.alive?'alive':'eliminated'}`).join('\n')).slice(0,1900):'No active event.');return;}
  if(sub==='start'){await startPublished(i,i.options.getString('event')||i.options.getString('id')||'');return;}
  if(!current)throw new Error('No event is active.');
  if(sub==='pause'){paused=true;await i.editReply('Workflow execution paused. The Rust game world continues.');return;}
  if(sub==='resume'){if(current.engine.status==='NEEDS_REVIEW')throw new Error('Reconcile interrupted operations before resuming.');paused=false;await i.editReply('Workflow execution resumed.');return;}
  if(sub==='stop'){paused=false;quitting=true;await i.editReply('Stopping workflow actions. Eligible returns are being recovered.');while(engineRunning)await new Promise(r=>setTimeout(r,100));quitting=false;current.engine.status='CANCELLED';await restoreEligible();await checkpoint(current.engine);await audit('event.cancelled','Owner cancelled event; return records retained.');return;}
 }
 }catch(e){const safe=e instanceof Error?e.message:'Operation failed.';if(i.deferred||i.replied)await i.editReply({content:safe.slice(0,1800),components:[]}).catch(()=>{});else await i.reply({content:safe.slice(0,1800),flags:64}).catch(()=>{});}});
client.once('clientReady',async()=>{try{await client.application.commands.set([botCommand.toJSON(),eventCommand.toJSON(),linkCommand.toJSON(),setupCommand.toJSON(),leaderboardCommand.toJSON(),rulesCommand.toJSON(),kitsCommand.toJSON()],config.guildId);await audit('runtime.started','Discord Gateway connected. Application commands registered.');if(current&&['RUNNING','READY'].includes(current.engine.status)){current.engine.status='NEEDS_REVIEW';log(current.engine,'recovery','Restart loaded persisted state. Live workflow awaits manual reconciliation.','warning');await checkpoint(current.engine);await restoreEligible();}}catch{console.error(JSON.stringify({event:'runtime_initialization_failed',botId}));}});
await client.login(boot.secrets.discordToken);
let polling=false;const heartbeat=setInterval(async()=>{if(polling||quitting)return;polling=true;try{try{verifiedInfo=await rce.info();rconConnected=true;}catch{rconConnected=false;}const response=await call('heartbeat',{status:client.isReady()&&rconConnected?'ONLINE':'DEGRADED',discordStatus:client.isReady()?'CONNECTED':'DISCONNECTED',rconStatus:rconConnected?'CONNECTED':'DISCONNECTED'});snapshot=response.snapshot;channelRoutes=readRoutes(response.channels);if(!snapshot.entitled){quitting=true;await shutdown('SUSPENDED');return;}if(response.channelJob)await processChannelJob(response.channelJob);if(channelRoutes.leaderboard&&Date.now()-lastLeaderboard>=300000)await updateLeaderboard().catch(()=>audit('leaderboard.refresh_failed','Leaderboard update failed. Check channel permissions.').catch(()=>{}));if(response.action==='reconnect'){// Restart the process through the supervisor; no additional RCON sessions.
 await call('action',{actor:snapshot.ownerDiscordId,guildId:config.guildId,action:'restart'});
 }if(current&&snapshot.modules.positionTracking){for(const p of current.engine.players.filter(p=>p.online&&p.alive).slice(0,20)){try{const pos=await adapter.readPosition(p);p.trail.push(p.position);p.trail=p.trail.slice(-60);p.position=pos;}catch{}}await checkpoint(current.engine);}
 }catch{rconConnected=false;}finally{polling=false;}},15000);
async function shutdown(status='STOPPED'){quitting=true;clearInterval(heartbeat);try{if(current){current.engine.status='NEEDS_REVIEW';await restoreEligible();await checkpoint(current.engine);}await call('heartbeat',{status,discordStatus:'DISCONNECTED',rconStatus:'DISCONNECTED'});}catch{}client.destroy();rce.close();process.exit(0);}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());