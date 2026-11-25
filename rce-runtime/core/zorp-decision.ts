// Pure decision engine. A decision is NOT confirmation of a real zone change.
// Adapted from KING3X: any online teammate cancels the offline timer, grace after restart,
// delayed protection, expiration. Missing or stale roster/player data must never trigger changes.
export type ZorpState='PENDING'|'ACTIVE'|'PROTECTED';
export type ZorpRecord={state:ZorpState;offlineSince:number|null;protectedSince:number|null;lastObservation:number|null};
export type ZorpObservation={now:number;startedAt:number;observedAt:number;rosterComplete:boolean;playerListComplete:boolean;members:string[];online:string[]};
export type ZorpRules={offlineDelay:number;expirationHours:number};
export function decideZorp(zone:ZorpRecord,obs:ZorpObservation,rules:ZorpRules){
 const hold=(reason:string)=>({action:'HOLD' as const,next:{...zone,offlineSince:null,lastObservation:null},reason});
 const {now,observedAt,startedAt}=obs;
 if(![now,observedAt,startedAt].every(Number.isFinite)||observedAt>now||now-observedAt>45000||startedAt>now||now-startedAt<300000||!obs.rosterComplete||!obs.playerListComplete||!obs.members.length)return hold('Fresh complete roster and player list required after startup grace.');
 if(!Number.isInteger(rules.offlineDelay)||rules.offlineDelay<1||rules.offlineDelay>120||!Number.isInteger(rules.expirationHours)||rules.expirationHours<1||rules.expirationHours>168)return hold('Invalid protection settings.');
 const normalize=(x:string)=>x.trim().toLowerCase();const online=new Set(obs.online.map(normalize));const members=obs.members.map(normalize);if(members.some(m=>!m)||new Set(members).size!==members.length)return hold('Ambiguous roster.');
 if(members.some(m=>online.has(m)))return {action:zone.state==='ACTIVE'?'KEEP_ACTIVE' as const:'ACTIVATE' as const,next:{...zone,offlineSince:null,protectedSince:null,lastObservation:observedAt},reason:'At least one team member online.'};
 if(zone.state==='PROTECTED'){if(zone.protectedSince!==null&&zone.protectedSince<=now&&now-zone.protectedSince>=rules.expirationHours*3600000)return {action:'REVIEW_EXPIRATION' as const,next:{...zone,lastObservation:observedAt},reason:'Protection expired; verify ownership and state before removing.'};return {action:'KEEP_PROTECTED' as const,next:{...zone,lastObservation:observedAt},reason:'Complete observation: all members offline.'};}
 const continuous=zone.lastObservation!==null&&observedAt>=zone.lastObservation&&observedAt-zone.lastObservation<=45000&&zone.offlineSince!==null&&zone.offlineSince<=observedAt;
 const since=continuous?zone.offlineSince!:observedAt;
 return {action:observedAt-since>=rules.offlineDelay*60000?'PROTECT' as const:'WAIT' as const,next:{...zone,offlineSince:since,lastObservation:observedAt},reason:'Complete observation: all members offline.'};
}
