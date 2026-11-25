import {readRoutes,validateRoute} from './channel-routing.ts';
import {createServer} from 'node:http';
import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {hash,verifySignature,resolveGameHost,botIdentity} from './guards.ts';
import {encrypt,decrypt} from '../../server/security.ts';
import {connectRce} from './rce.ts';
const pgName='pg';const {Pool}=await import(pgName);const pool=new Pool({connectionString:process.env.DATABASE_URL,max:12});
const required=(key:string)=>{const value=process.env[key];if(!value)throw new Error(`Missing required environment variable: ${key}`);return value;};
const signingKey=required('SUPERVISOR_KEY'),secretKey=required('RUNTIME_SECRETS_KEY');
const ownerTenant=required('OWNER_TENANT_ID');
const internalUrl=()=>`http://127.0.0.1:${Number(process.env.PORT||8080)}`;
const planeOrigin=required('CONTROL_PLANE_URL');if(!planeOrigin.startsWith('https://'))throw new Error('Control plane must use HTTPS.');
await pool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
await pool.query('ALTER TABLE runtime_bots ADD COLUMN IF NOT EXISTS desired_running boolean NOT NULL DEFAULT false');
let supervisorLease:any=null;
let leaseReady=false;
// Free-tier evaluation runtime: one owner bot, isolated subprocess, no Docker socket.
const children=new Map<string,ChildProcess>();
let shuttingDown=false;
function launch(id:string,epoch:string,token:string){
 if(shuttingDown||children.size||children.has(id))throw new Error('Free runtime capacity is occupied.');
 const child=spawn(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('./worker.ts',import.meta.url))],{env:{PATH:process.env.PATH,NODE_ENV:'production',BOT_ID:id,LEASE_EPOCH:epoch,WORKER_TOKEN:token,SUPERVISOR_INTERNAL_URL:internalUrl()},stdio:['ignore','ignore','ignore']});
 children.set(id,child);
 const failed=()=>{if(children.get(id)!==child)return;children.delete(id);void pool.query("UPDATE runtime_bots SET status=CASE WHEN status IN ('STOPPED','SUSPENDED') THEN status ELSE 'ERROR' END, discord_status='DISCONNECTED',rcon_status='DISCONNECTED',updated_at=now() WHERE id=$1 AND lease_epoch=$2",[id,epoch]).catch(()=>{});};
 child.once('error',failed);child.once('exit',failed);
}
async function stopChild(id:string){
 const child=children.get(id);if(!child)return;
 await new Promise<void>((resolve,reject)=>{
  const t=setTimeout(()=>{child.kill('SIGKILL');},10000);
  const hard=setTimeout(()=>{clearTimeout(t);reject(new Error('Worker did not exit.'));},13000);
  child.once('exit',()=>{clearTimeout(t);clearTimeout(hard);resolve();});
  child.once('error',()=>{clearTimeout(t);clearTimeout(hard);reject(new Error('Worker shutdown failed.'));});
  child.kill('SIGTERM');
 });
}
async function plane(tenantId:string,botId:string,action:string,extra:Record<string,unknown>={}){const raw=JSON.stringify({tenantId,botId,action,...extra}),stamp=String(Date.now()),nonce=randomUUID();const signature=createHmac('sha256',signingKey).update(`${stamp}.${nonce}.${raw}`).digest('hex');const r=await fetch(planeOrigin+'/api/runtime',{method:'POST',headers:{'Content-Type':'application/json','X-RCE-Timestamp':stamp,'X-RCE-Nonce':nonce,'X-RCE-Signature':signature},body:raw,signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok){const body=(await r.text()).slice(0,4096);const kind=/Runtime authentication|Runtime service credentials/i.test(body)?'missing_runtime_auth':/Invalid service signature/i.test(body)?'invalid_signature':/database|supabase/i.test(body)?'database_error':/Deployment Protection|Authentication Required|Vercel Authentication/i.test(body)?'deployment_protection':/configuration|configured/i.test(body)?'configuration_error':'unknown';console.error(JSON.stringify({event:'control_plane_http_error',status:r.status,action,kind,contentType:r.headers.get('content-type')}));throw new Error('Control plane did not authorize the operation.');}return r.json() as Promise<any>;}
async function reserve(serverKey:string){const now=Date.now();const r=await pool.query('INSERT INTO rcon_slots(server_key,next_at) VALUES($1,$2) ON CONFLICT(server_key) DO UPDATE SET next_at=greatest(rcon_slots.next_at,$3)+750 RETURNING next_at',[serverKey,now+750,now]);const delay=Math.max(0,Number(r.rows[0].next_at)-750-now);if(delay>15000)throw new Error('Server RCON queue saturated.');await new Promise(r=>setTimeout(r,delay));}
async function control(tenantId:string,action:string,p:any){const{id}=botIdentity(tenantId,p.id);if(tenantId!==ownerTenant)throw new Error('Free runtime is restricted to the platform owner.');if(action==='probe'){const snapshot=await plane(tenantId,id,'snapshot');return {ok:true,entitled:snapshot.entitled===true,discordVerified:typeof snapshot.ownerDiscordId==='string'&&snapshot.ownerDiscordId.length>0};}if(action==='test-rcon'){const host=await resolveGameHost(p.host);const started=Date.now();const rce=await connectRce({id,host,port:p.port,password:p.password},()=>reserve(hash(host+':'+p.port)));try{return {connected:true,info:await rce.info(),latency:Date.now()-started};}finally{rce.close();}}
 const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(74123982)');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[id]);let launchAfterCommit:{token:string;epoch:string}|null=null;let row=(await client.query('SELECT * FROM runtime_bots WHERE id=$1',[id])).rows[0];if(row&&row.tenant_id!==tenantId)throw new Error('Tenant mismatch.');
 if(p.jobId){const exists=await client.query('SELECT * FROM runtime_jobs WHERE id=$1',[p.jobId]);if(exists.rows.length){if(exists.rows[0].tenant_id!==tenantId||exists.rows[0].bot_id!==id)throw new Error('Job identity mismatch.');await client.query('ROLLBACK');return{status:row?.status||'STARTING',idempotent:true};}}
 if(!['start','stop','restart','reconnect','refresh'].includes(action))throw new Error('Unsupported lifecycle action.');
 if(action==='stop'||action==='restart'){if(!row)throw new Error('Bot is not provisioned.');await stopChild(id);}
 if(action==='start'||action==='restart'){
  const snapshot=await plane(tenantId,id,'snapshot');if(!snapshot.entitled||!snapshot.ownerDiscordId)throw new Error('Active entitlement and Discord ownership are required.');
  const token=randomBytes(32).toString('hex'),epoch=randomUUID();const host=await resolveGameHost(p.host);const credentials=await encrypt(JSON.stringify({discordToken:p.discordToken,password:p.password}),secretKey,`${tenantId}:${id}`);const config={id,tenantId,host,port:Number(p.port),applicationId:p.applicationId,guildId:p.guildId,serverKey:hash(host+':'+p.port),channels:row?.config?.guildId===p.guildId&&row?.config?.serverKey===hash(host+':'+p.port)?readRoutes(row.config.channels):{}};
  // Commit the lease before a subprocess can bootstrap. Never run two bots on the free service.
   if(children.size)throw new Error('Free runtime already has an active bot.');
   if(!Number.isInteger(config.port)||config.port<1||config.port>65535||typeof p.discordToken!=='string'||typeof p.password!=='string'||!p.discordToken||!p.password)throw new Error('Invalid bot credentials.');
   await client.query("INSERT INTO runtime_bots(id,tenant_id,config,encrypted_secrets,worker_token_hash,status,lease_epoch,desired_running) VALUES($1,$2,$3,$4,$5,$6,$7,true) ON CONFLICT(id) DO UPDATE SET config=$3,encrypted_secrets=$4,worker_token_hash=$5,status=$6,lease_epoch=$7,desired_running=true,updated_at=now()",[id,tenantId,config,credentials,hash(token),'STARTING',epoch]);
   launchAfterCommit={token,epoch};
  }else if(action==='stop'){await client.query("UPDATE runtime_bots SET status='STOPPED',desired_running=false,discord_status='DISCONNECTED',rcon_status='DISCONNECTED',worker_token_hash=$2,updated_at=now() WHERE id=$1",[id,hash(randomBytes(32).toString('hex'))]);}
 else {if(!row)throw new Error('Bot is not provisioned.');await client.query("UPDATE runtime_bots SET config=jsonb_set(config,'{requestedAction}',$2::jsonb) WHERE id=$1",[id,JSON.stringify(action)]);}
 if(p.jobId)await client.query('INSERT INTO runtime_jobs(id,tenant_id,bot_id,action,status) VALUES($1,$2,$3,$4,$5)',[p.jobId,tenantId,id,action,'ACCEPTED']);await client.query('COMMIT');if(launchAfterCommit)launch(id,launchAfterCommit.epoch,launchAfterCommit.token);return{status:action==='stop'?'STOPPED':action==='refresh'||action==='reconnect'?row.status:'STARTING'};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
async function workerCall(path:string,token:string,b:any){if(!/^[-a-f0-9]{36}$/.test(b.botId||'')||!token)throw new Error('Invalid worker identity.');const row=(await pool.query('SELECT * FROM runtime_bots WHERE id=$1 AND worker_token_hash=$2 AND lease_epoch=$3',[b.botId,hash(token),b.epoch])).rows[0];if(!row)throw new Error('Worker lease is invalid or revoked.');
 if(path==='/v1/runtime/bootstrap'){const secrets=JSON.parse(await decrypt(row.encrypted_secrets,secretKey,`${row.tenant_id}:${row.id}`));return {config:row.config,secrets,state:row.state,revision:Number(row.revision),snapshot:await plane(row.tenant_id,row.id,'snapshot')};}
 if(path==='/v1/runtime/checkpoint'){
  const client=await pool.connect();try{await client.query('BEGIN');const result=await client.query('UPDATE runtime_bots SET state=$4,revision=revision+1,updated_at=now() WHERE id=$1 AND lease_epoch=$2 AND revision=$3 RETURNING revision',[row.id,b.epoch,b.revision,b.state]);if(!result.rows.length)throw new Error('Checkpoint revision conflict.');for(const p of b.state?.engine?.players||[])if(p.origin)await client.query('INSERT INTO runtime_returns(bot_id,run_id,player_id,tenant_id,position,status,destination) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(bot_id,run_id,player_id) DO UPDATE SET status=$6,destination=$7',[row.id,b.state.engine.runId,p.id,row.tenant_id,p.origin,p.returned?'RETURNED':'PENDING',p.exitGate||p.origin]);await client.query('COMMIT');return{revision:Number(result.rows[0].revision)};}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 if(path==='/v1/runtime/rate'){await reserve(row.config.serverKey);return{ok:true};}
 if(path==='/v1/runtime/heartbeat'){
  const snapshot=await plane(row.tenant_id,row.id,'snapshot');await plane(row.tenant_id,row.id,'heartbeat',{status:b.status,discordStatus:b.discordStatus,rconStatus:b.rconStatus});await pool.query("UPDATE runtime_bots SET heartbeat=now(),status=$2,discord_status=$3,rcon_status=$4,desired_running=CASE WHEN $2='SUSPENDED' THEN false ELSE desired_running END WHERE id=$1 AND lease_epoch=$5",[row.id,b.status,b.discordStatus,b.rconStatus,b.epoch]);const action=row.config.requestedAction;await pool.query("UPDATE runtime_bots SET config=config-'requestedAction' WHERE id=$1 AND lease_epoch=$2",[row.id,b.epoch]);return{snapshot,action,channels:readRoutes(row.config.channels)};
 }
 if(path==='/v1/runtime/link'){if(!/^\d{17,20}$/.test(b.discordId)||typeof b.ign!=='string'||b.ign.length>64)throw new Error('Invalid identity link.');await pool.query('INSERT INTO runtime_links(bot_id,discord_id,ign) VALUES($1,$2,$3) ON CONFLICT(bot_id,discord_id) DO UPDATE SET ign=$3,verified_at=now()',[row.id,b.discordId,b.ign]);return{ok:true};}
 if(path==='/v1/runtime/links'){return{links:(await pool.query('SELECT discord_id,ign FROM runtime_links WHERE bot_id=$1',[row.id])).rows};}
 if(path==='/v1/runtime/channel'){
  const snapshot=await plane(row.tenant_id,row.id,'snapshot');
  if(!snapshot.entitled||b.actor!==snapshot.ownerDiscordId||b.guildId!==row.config.guildId)throw new Error('Owner authorization required.');
  if(!validateRoute(b.type,b.channelId))throw new Error('Invalid or unsupported channel route.');
  const result=await pool.query("UPDATE runtime_bots SET config=jsonb_set(config,'{channels}',COALESCE(config->'channels','{}'::jsonb)||jsonb_build_object($3::text,$4::text),true),updated_at=now() WHERE id=$1 AND tenant_id=$2 AND lease_epoch=$5 RETURNING config",[row.id,row.tenant_id,b.type,b.channelId,b.epoch]);
  if(!result.rows.length)throw new Error('Worker lease changed.');
  await plane(row.tenant_id,row.id,'audit',{type:'channel.updated',detail:'Configured '+b.type+' channel.'}).catch(()=>{});
  return {channels:readRoutes(result.rows[0].config.channels)};
 }
 if(path==='/v1/runtime/module')return plane(row.tenant_id,row.id,'module',{actor:b.actor,guildId:b.guildId,module:b.module,enabled:b.enabled});
 if(path==='/v1/runtime/audit'){await plane(row.tenant_id,row.id,'audit',{type:b.type,detail:b.detail});return{ok:true};}
 if(path==='/v1/runtime/action'){const snapshot=await plane(row.tenant_id,row.id,'snapshot');if(b.actor!==snapshot.ownerDiscordId||b.guildId!==row.config.guildId)throw new Error('Owner authorization required.');if(!['restart','stop','reconnect','refresh'].includes(b.action))throw new Error('Invalid administration action.');const secret=JSON.parse(await decrypt(row.encrypted_secrets,secretKey,`${row.tenant_id}:${row.id}`));setTimeout(()=>control(row.tenant_id,b.action,{...row.config,...secret,jobId:randomUUID()}).catch(()=>console.error(JSON.stringify({event:'lifecycle_failed',botId:row.id}))),1500);return{accepted:true};}
 throw new Error('Unsupported worker action.');
}
const server=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');try{if(req.method==='GET'&&req.url==='/healthz'){await pool.query('SELECT 1');res.end(JSON.stringify({ok:true}));return;}if(!leaseReady||shuttingDown){res.statusCode=503;res.end(JSON.stringify({error:'Runtime is acquiring its active lease.'}));return;}if(req.method!=='POST')throw new Error('Method not allowed.');let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>500000)throw new Error('Payload too large.');}if(req.url==='/webhooks/stripe'){
 const forwarded=await fetch(planeOrigin+'/api/billing?webhook=stripe',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':String(req.headers['stripe-signature']||'')},body:raw,signal:AbortSignal.timeout(15000),redirect:'error'});
 res.statusCode=forwarded.status;res.end(await forwarded.text());return;
}const body=JSON.parse(raw);if(req.url==='/v1/control'){
 const stamp=String(req.headers['x-rce-timestamp']||''),nonce=String(req.headers['x-rce-nonce']||''),sig=String(req.headers['x-rce-signature']||'');if(!verifySignature(signingKey,stamp,nonce,raw,sig))throw new Error('Invalid service signature.');const used=await pool.query('INSERT INTO runtime_nonces(nonce,expires_at) VALUES($1,now()+interval \'2 minutes\') ON CONFLICT DO NOTHING RETURNING nonce',[nonce]);if(!used.rows.length)throw new Error('Duplicate request.');res.end(JSON.stringify(await control(body.tenantId,body.action,body.payload)));return;}
 const token=String(req.headers.authorization||'').replace(/^Bearer /,'');res.end(JSON.stringify(await workerCall(req.url||'',token,body)));
 }catch(err){console.error(JSON.stringify({event:'runtime_operation_rejected',route:req.url?.split('?')[0],code:err instanceof Error?err.name:'Error',reason:err instanceof Error&&['Invalid service signature.','Duplicate request.','Invalid tenant or bot identity.','Free runtime is restricted to the platform owner.','Control plane did not authorize the operation.'].includes(err.message)?err.message:undefined}));res.statusCode=400;res.end(JSON.stringify({error:'Runtime operation denied or unavailable.'}));}});
async function recover(){
 const result=await pool.query("SELECT * FROM runtime_bots WHERE desired_running=true AND tenant_id=$1 ORDER BY updated_at DESC LIMIT 1",[ownerTenant]);
 const row=result.rows[0];if(!row||children.size||shuttingDown)return;
 const previous=row.state?.engine;
 if(previous?.status==='NEEDS_REVIEW'){
 const last=previous.logs?.filter((l:any)=>l.level==='error').at(-1);
 const message=String(last?.message||'');
 const reason=/Missing Permissions|50013|missing channel permissions/i.test(message)?'discord_missing_permissions':/Missing Access|Unknown Channel|50001|10003/i.test(message)?'discord_channel_unavailable':/Invalid Form Body|50035/i.test(message)?'discord_invalid_payload':/checkpoint|persistence/i.test(message)?'persistence_error':/without participants/i.test(message)?'no_participants':'other';
 console.log(JSON.stringify({event:'saved_event_diagnostic',status:previous.status,node:previous.pending?.kind||null,reason,commands:previous.commands,participants:previous.players?.length,pendingReturns:previous.players?.filter((p:any)=>p.pendingReturn).length}));
 }
 const snapshot=await plane(row.tenant_id,row.id,'snapshot');
 if(!snapshot.entitled||!snapshot.ownerDiscordId){await pool.query("UPDATE runtime_bots SET desired_running=false,status='SUSPENDED' WHERE id=$1",[row.id]);return;}
 const token=randomBytes(32).toString('hex'),epoch=randomUUID();
 await pool.query("UPDATE runtime_bots SET worker_token_hash=$2,lease_epoch=$3,status='STARTING',discord_status='DISCONNECTED',rcon_status='DISCONNECTED' WHERE id=$1",[row.id,hash(token),epoch]);
 launch(row.id,epoch,token);
}
async function probe(){
 const id=process.env.PROBE_BOT_ID;if(!id)return;
 try{
  botIdentity(ownerTenant,id);
  const raw=JSON.stringify({tenantId:ownerTenant,action:'probe',payload:{id}});
  const stamp=String(Date.now()),nonce=randomUUID(),sig=createHmac('sha256',signingKey).update(stamp+'.'+nonce+'.'+raw).digest('hex');
  const response=await fetch(internalUrl()+'/v1/control',{method:'POST',headers:{'Content-Type':'application/json','X-RCE-Timestamp':stamp,'X-RCE-Nonce':nonce,'X-RCE-Signature':sig},body:raw,signal:AbortSignal.timeout(18000)});
  if(!response.ok)throw new Error('Control probe failed.');
  const result=await response.json();
  console.log(JSON.stringify({event:'control_plane_probe',ok:result.ok===true,entitled:result.entitled===true,discordVerified:result.discordVerified===true}));
 }catch{console.error(JSON.stringify({event:'control_plane_probe_failed'}));}
}
async function acquireLease(){
 const connection=await pool.connect();supervisorLease=connection;
 connection.on('error',()=>process.exit(1));
 while(!shuttingDown){
  if((await connection.query('SELECT pg_try_advisory_lock(74123981) AS locked')).rows[0].locked){
   leaseReady=true;console.log(JSON.stringify({event:'supervisor_ready'}));
   await recover().catch(()=>console.error(JSON.stringify({event:'recovery_failed'})));
   await probe();return;
  }
  await new Promise(resolve=>setTimeout(resolve,1500));
 }
}
server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>{console.log(JSON.stringify({event:'supervisor_listening'}));void acquireLease().catch(()=>process.exit(1));});
async function shutdown(){if(shuttingDown)return;shuttingDown=true;leaseReady=false;await Promise.allSettled([...children.keys()].map(stopChild));server.close();supervisorLease?.release();await pool.end();process.exit(0);}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
setInterval(()=>pool.query("DELETE FROM runtime_nonces WHERE expires_at<now()").catch(()=>{}),60000).unref();