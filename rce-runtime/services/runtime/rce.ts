import {resolveGameHost,SerialQueue} from './guards.ts';
export async function connectRce(input:{id:string;host:string;port:number;password:string},slot:()=>Promise<void>){
 const imported=await import('rce.js');const Manager=imported.default?.default??imported.default??imported.RCEManager;
 if(typeof Manager!=='function')throw new Error('Unsupported rce.js module export.');
 const manager=new Manager({logger:{level:0,instance:{info(){},error(){},warn(){},debug(){}}}});
 const ip=await resolveGameHost(input.host);const queue=new SerialQueue();
 manager.on('error',()=>{});
 let timer;const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('RCON authentication timed out.')),12000);timer.unref();});
 try{const connected=await Promise.race([manager.addServer({identifier:input.id,rcon:{host:ip,port:input.port,password:input.password},intents:[],state:[],reconnection:{enabled:true,interval:5000,maxAttempts:10}}),timeout]);if(connected!==true)throw new Error('RCON authentication failed.');}catch(err){manager.destroy();throw err;}finally{clearTimeout(timer);}
 const request=(command:string)=>queue.run(async()=>{await slot();const result=await manager.sendCommand(input.id,command);if(typeof result!=='string')throw new Error('RCON returned no correlated response.');return result;});
 return {manager,request,close:()=>manager.destroy(),async info(){const raw=await request('serverinfo');let data;try{data=JSON.parse(raw);}catch{throw new Error('Server info response is not valid JSON.');}if(typeof data.Hostname!=='string'||typeof data.Players!=='number'||typeof data.MaxPlayers!=='number')throw new Error('Unrecognized serverinfo response.');return data;}};
}