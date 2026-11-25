import {createServer,request as httpRequest} from 'node:http';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {hash,verifySignature,resolveGameHost,botIdentity} from './guards.ts';
import {encrypt,decrypt} from '../../server/security.ts';
import {connectRce} from './rce.ts';
const pgName='pg';const {Pool}=await import(pgName);const pool=new Pool({connectionString:process.env.DATABASE_URL,max:12});
const required=(key:string)=>{const value=process.env[key];if(!value)throw new Error(`Missing required environment variable: ${key}`);return value;};
const signingKey=required('SUPERVISOR_KEY'),secretKey=required('RUNTIME_SECRETS_KEY'),workerImage=required('WORKER_IMAGE');
const planeOrigin=required('CONTROL_PLANE_URL');if(!planeOrigin.startsWith('https://'))throw new Error('Control plane must use HTTPS.');
await pool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
function docker(method:string,path:string,body?:unknown){
 return new Promise<any>((resolve,reject)=>{
  const req=httpRequest({socketPath:'/var/run/docker.sock',method,path:'/v1.45'+path,headers:body?{'Content-Type':'application/json'}:{}},res=>{
   let data='';res.on('data',c=>data+=c);
   res.on('end',()=>{if((res.statusCode||500)>=400)return reject(new Error(`Container operation failed (${res.statusCode}).`));try{resolve(data?JSON.parse(data):{});}catch{resolve({});}});
  });
  req.on('error',reject);req.setTimeout(35000,()=>req.destroy(new Error('Container API timeout.')));
  if(body)req.write(JSON.stringify(body));req.end();
 });
}
async function plane(tenantId:string,botId:string,action:string,extra:Record<string,unknown>={}){const raw=JSON.stringify({tenantId,botId,action,...extra}),stamp=String(Date.now()),nonce=randomUUID();const signature=createHmac('sha256',required('CONTROL_PLANE_KEY')).update(`${stamp}.${nonce}.${raw}`).digest('hex');const r=await fetch(planeOrigin+'/api/runtime',{method:'POST',headers:{'Content-Type':'application/json','X-RCE-Timestamp':stamp,'X-RCE-Nonce':nonce,'X-RCE-Signature':signature,'OAI-Sites-Authorization':'Bearer '+required('SITES_SERVICE_TOKEN')},body:raw,signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw new Error('Control plane did not authorize the operation.');return r.json() as Promise<any>;}
async function reserve(serverKey:string){const now=Date.now();const r=await pool.query('INSERT INTO rcon_slots(server_key,next_at) VALUES($1,$2) ON CONFLICT(server_key) DO UPDATE SET next_at=greatest(rcon_slots.next_at,$3)+750 RETURNING next_at',[serverKey,now+750,now]);const delay=Math.max(0,Number(r.rows[0].next_at)-750-now);if(delay>15000)throw new Error('Server RCON queue saturated.');await new Promise(r=>setTimeout(r,delay));}
async function control(tenantId:string,action:string,p:any){const{id}=botIdentity(tenantId,p.id);if(action==='test-rcon'){const host=await resolveGameHost(p.host);const started=Date.now();const rce=await connectRce({id,host,port:p.port,password:p.password},()=>reserve(hash(host+':'+p.port)));try{return {connected:true,info:await rce.info(),latency:Date.now()-started};}finally{rce.close();}}
 const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[id]);let row=(await client.query('SELECT * FROM runtime_bots WHERE id=$1',[id])).rows[0];if(row&&row.tenant_id!==tenantId)throw new Error('Tenant mismatch.');
 if(p.jobId){const exists=await client.query('SELECT * FROM runtime_jobs WHERE id=$1',[p.jobId]);if(exists.rows.length){if(exists.rows[0].tenant_id!==tenantId||exists.rows[0].bot_id!==id)throw new Error('Job identity mismatch.');await client.query('ROLLBACK');return{status:row?.status||'STARTING',idempotent:true};}}
 if(!['start','stop','restart','reconnect','refresh'].includes(action))throw new Error('Unsupported lifecycle action.');
 if(action==='stop'||action==='restart'){if(!row)throw new Error('Bot is not provisioned.');await docker('POST',`/containers/rcec-${id}/stop?t=30`).catch(async()=>{const x=await docker('GET',`/containers/rcec-${id}/json`);if(x.State.Running)throw new Error('Could not stop previous instance.');});if(action==='restart')await docker('DELETE',`/containers/rcec-${id}`);}
 if(action==='start'||action==='restart'){
  const snapshot=await plane(tenantId,id,'snapshot');if(!snapshot.entitled||!snapshot.ownerDiscordId)throw new Error('Active entitlement and Discord ownership are required.');
  const token=randomBytes(32).toString('hex'),epoch=randomUUID();const host=await resolveGameHost(p.host);const credentials=await encrypt(JSON.stringify({discordToken:p.discordToken,password:p.password}),secretKey,`${tenantId}:${id}`);const config={id,tenantId,host,port:Number(p.port),applicationId:p.applicationId,guildId:p.guildId,serverKey:hash(host+':'+p.port)};
  // Do not replace an active instance behind its worker. Docker's unique name is an additional exclusion lock.
  if(action==='start'&&row){const old=await docker('GET',`/containers/rcec-${id}/json`).catch(()=>null);if(old?.State?.Running)throw new Error('Instance already running.');if(old)await docker('DELETE',`/containers/rcec-${id}`);}
  await client.query('INSERT INTO runtime_bots(id,tenant_id,config,encrypted_secrets,worker_token_hash,status,lease_epoch) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET config=$3,encrypted_secrets=$4,worker_token_hash=$5,status=$6,lease_epoch=$7,updated_at=now()',[id,tenantId,config,credentials,hash(token),'STARTING',epoch]);
  await docker('POST',`/containers/create?name=rcec-${id}`,{Image:workerImage,User:'1000:1000',Env:[`BOT_ID=${id}`,`WORKER_TOKEN=${token}`,`LEASE_EPOCH=${epoch}`,`SUPERVISOR_INTERNAL_URL=${required('WORKER_SUPERVISOR_URL')}`],Labels:{'rcec.managed':'true','rcec.tenant':tenantId,'rcec.bot':id},HostConfig:{Memory:268435456,NanoCpus:500000000,PidsLimit:64,ReadonlyRootfs:true,CapDrop:['ALL'],SecurityOpt:['no-new-privileges:true'],Tmpfs:{'/tmp':'rw,noexec,nosuid,size=32m'},RestartPolicy:{Name:'unless-stopped'},NetworkMode:required('DOCKER_NETWORK'),LogConfig:{Type:'json-file',Config:{'max-size':'5m','max-file':'2'}}}});
  await docker('POST',`/containers/rcec-${id}/start`);
 }else if(action==='stop'){await client.query("UPDATE runtime_bots SET status='STOPPED',worker_token_hash=$2,updated_at=now() WHERE id=$1",[id,hash(randomBytes(32).toString('hex'))]);}
 else {if(!row)throw new Error('Bot is not provisioned.');await client.query("UPDATE runtime_bots SET config=jsonb_set(config,'{requestedAction}',$2::jsonb) WHERE id=$1",[id,JSON.stringify(action)]);}
 if(p.jobId)await client.query('INSERT INTO runtime_jobs(id,tenant_id,bot_id,action,status) VALUES($1,$2,$3,$4,$5)',[p.jobId,tenantId,id,action,'ACCEPTED']);await client.query('COMMIT');return{status:action==='stop'?'STOPPED':action==='refresh'||action==='reconnect'?row.status:'STARTING'};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
async function workerCall(path:string,token:string,b:any){if(!/^[-a-f0-9]{36}$/.test(b.botId||'')||!token)throw new Error('Invalid worker identity.');const row=(await pool.query('SELECT * FROM runtime_bots WHERE id=$1 AND worker_token_hash=$2 AND lease_epoch=$3',[b.botId,hash(token),b.epoch])).rows[0];if(!row)throw new Error('Worker lease is invalid or revoked.');
 if(path==='/v1/runtime/bootstrap'){const secrets=JSON.parse(await decrypt(row.encrypted_secrets,secretKey,`${row.tenant_id}:${row.id}`));return {config:row.config,secrets,state:row.state,revision:Number(row.revision),snapshot:await plane(row.tenant_id,row.id,'snapshot')};}
 if(path==='/v1/runtime/checkpoint'){
  const client=await pool.connect();try{await client.query('BEGIN');const result=await client.query('UPDATE runtime_bots SET state=$4,revision=revision+1,updated_at=now() WHERE id=$1 AND lease_epoch=$2 AND revision=$3 RETURNING revision',[row.id,b.epoch,b.revision,b.state]);if(!result.rows.length)throw new Error('Checkpoint revision conflict.');for(const p of b.state?.engine?.players||[])if(p.origin)await client.query('INSERT INTO runtime_returns(bot_id,run_id,player_id,tenant_id,position,status,destination) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(bot_id,run_id,player_id) DO UPDATE SET status=$6,destination=$7',[row.id,b.state.engine.runId,p.id,row.tenant_id,p.origin,p.returned?'RETURNED':'PENDING',p.exitGate||p.origin]);await client.query('COMMIT');return{revision:Number(result.rows[0].revision)};}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 if(path==='/v1/runtime/rate'){await reserve(row.config.serverKey);return{ok:true};}
 if(path==='/v1/runtime/heartbeat'){
  const snapshot=await plane(row.tenant_id,row.id,'snapshot');await plane(row.tenant_id,row.id,'heartbeat',{status:b.status,discordStatus:b.discordStatus,rconStatus:b.rconStatus});await pool.query('UPDATE runtime_bots SET heartbeat=now(),status=$2,discord_status=$3,rcon_status=$4 WHERE id=$1 AND lease_epoch=$5',[row.id,b.status,b.discordStatus,b.rconStatus,b.epoch]);const action=row.config.requestedAction;await pool.query("UPDATE runtime_bots SET config=config-'requestedAction' WHERE id=$1 AND lease_epoch=$2",[row.id,b.epoch]);return{snapshot,action};
 }
 if(path==='/v1/runtime/link'){if(!/^\d{17,20}$/.test(b.discordId)||typeof b.ign!=='string'||b.ign.length>64)throw new Error('Invalid identity link.');await pool.query('INSERT INTO runtime_links(bot_id,discord_id,ign) VALUES($1,$2,$3) ON CONFLICT(bot_id,discord_id) DO UPDATE SET ign=$3,verified_at=now()',[row.id,b.discordId,b.ign]);return{ok:true};}
 if(path==='/v1/runtime/links'){return{links:(await pool.query('SELECT discord_id,ign FROM runtime_links WHERE bot_id=$1',[row.id])).rows};}
 if(path==='/v1/runtime/module')return plane(row.tenant_id,row.id,'module',{actor:b.actor,guildId:b.guildId,module:b.module,enabled:b.enabled});
 if(path==='/v1/runtime/audit'){await plane(row.tenant_id,row.id,'audit',{type:b.type,detail:b.detail});return{ok:true};}
 if(path==='/v1/runtime/action'){const snapshot=await plane(row.tenant_id,row.id,'snapshot');if(b.actor!==snapshot.ownerDiscordId||b.guildId!==row.config.guildId)throw new Error('Owner authorization required.');if(!['restart','stop','reconnect','refresh'].includes(b.action))throw new Error('Invalid administration action.');const secret=JSON.parse(await decrypt(row.encrypted_secrets,secretKey,`${row.tenant_id}:${row.id}`));setTimeout(()=>control(row.tenant_id,b.action,{...row.config,...secret,jobId:randomUUID()}).catch(()=>console.error(JSON.stringify({event:'lifecycle_failed',botId:row.id}))),1500);return{accepted:true};}
 throw new Error('Unsupported worker action.');
}
const server=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');try{if(req.method==='GET'&&req.url==='/healthz'){await pool.query('SELECT 1');res.end(JSON.stringify({ok:true}));return;}if(req.method!=='POST')throw new Error('Method not allowed.');let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>500000)throw new Error('Payload too large.');}if(req.url==='/webhooks/stripe'){
 const forwarded=await fetch(planeOrigin+'/api/billing?webhook=stripe',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':String(req.headers['stripe-signature']||''),'OAI-Sites-Authorization':'Bearer '+required('SITES_SERVICE_TOKEN')},body:raw,signal:AbortSignal.timeout(15000),redirect:'error'});
 res.statusCode=forwarded.status;res.end(await forwarded.text());return;
}const body=JSON.parse(raw);if(req.url==='/v1/control'){
 const stamp=String(req.headers['x-rce-timestamp']||''),nonce=String(req.headers['x-rce-nonce']||''),sig=String(req.headers['x-rce-signature']||'');if(!verifySignature(signingKey,stamp,nonce,raw,sig))throw new Error('Invalid service signature.');const used=await pool.query('INSERT INTO runtime_nonces(nonce,expires_at) VALUES($1,now()+interval \'2 minutes\') ON CONFLICT DO NOTHING RETURNING nonce',[nonce]);if(!used.rows.length)throw new Error('Duplicate request.');res.end(JSON.stringify(await control(body.tenantId,body.action,body.payload)));return;}
 const token=String(req.headers.authorization||'').replace(/^Bearer /,'');res.end(JSON.stringify(await workerCall(req.url||'',token,body)));
 }catch{res.statusCode=400;res.end(JSON.stringify({error:'Runtime operation denied or unavailable.'}));}});
server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log(JSON.stringify({event:'supervisor_ready'})));
setInterval(()=>pool.query("DELETE FROM runtime_nonces WHERE expires_at<now()").catch(()=>{}),60000).unref();