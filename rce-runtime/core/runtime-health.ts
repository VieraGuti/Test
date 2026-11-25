// Heartbeat is evidence of a recent connection, not a perpetual online flag.
export function runtimeHealth(status:string,heartbeat:unknown,discordStatus:string,rconStatus:string,now=Date.now()){
 const time=typeof heartbeat==='number'?heartbeat:heartbeat instanceof Date?heartbeat.getTime():typeof heartbeat==='string'?(/^\d+$/.test(heartbeat)?Number(heartbeat):Date.parse(heartbeat)):NaN;
 const age=Number.isFinite(time)?now-time:Infinity;
 const stale=['ONLINE','DEGRADED','STARTING'].includes(status)&&(age>60000||age< -10000||!Number.isFinite(age));
 return {status:stale?'DEGRADED':status,discordStatus:stale?'DISCONNECTED':discordStatus,rconStatus:stale?'DISCONNECTED':rconStatus,heartbeatStale:stale,heartbeatAgeSeconds:Number.isFinite(age)?Math.max(0,Math.floor(age/1000)):null};
}
