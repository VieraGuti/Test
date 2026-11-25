import { ENTITIES } from './catalog.ts';
import type {Vec3} from './types.ts';
export function quoted(value:string) {if(!value||value.length>80||/["\\;\r\n\x00-\x1f]/.test(value)) throw new Error('Unsafe command argument.');return '"'+value+'"';}
export function coords(v:Vec3,parens=true){if(![v.x,v.y,v.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=10000))throw new Error('Invalid coordinates.');const s=[v.x,v.y,v.z].map(n=>Number(n.toFixed(2))).join(',');return parens?'('+s+')':s;}
export const commands={
 position:(name:string)=>'server.printpos '+quoted(name),
 teleport:(name:string,pos:Vec3)=>'global.teleportpos '+coords(pos)+' '+quoted(name),
 kit:(name:string,kit:string)=>'kit givetoplayer '+quoted(kit)+' '+quoted(name),
 spawn:(entity:string,pos:Vec3)=>{if(!ENTITIES.includes(entity))throw new Error('Unsupported entity.');return 'entity.spawn '+entity+' '+coords(pos,false);},
 zone:(name:string,pos:Vec3,radius:number,radiation:number,pvp:boolean)=>{if(!name.startsWith('rcec_')||radius<5||radius>500||radiation<0||radiation>100||![radius,radiation].every(Number.isFinite))throw new Error('Invalid event-owned zone.');return 'zones.createcustomzone '+quoted(name)+' '+coords(pos)+' 0 Sphere '+radius+' '+(pvp?1:0)+' 1 '+radiation+' 0 0';},
 deleteZone:(name:string)=>{if(!/^rcec_[\w-]+$/.test(name))throw new Error('Only event-owned zones may be removed.');return 'zones.deletecustomzone '+quoted(name);}
};
export function parsePosition(raw:string,expectedPlayer:string):Vec3 {
 const escaped=expectedPlayer.replace(/[.*+?^$()|[\]\\{}]/g,'\\$&');
 const pattern=new RegExp('(?:^|["\\s])'+escaped+'(?:["\\s:]|$)','i');
 if(!pattern.test(raw))throw new Error('Position response does not identify the expected player.');
 const matches=[...raw.matchAll(/\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/g)];
 if(matches.length!==1)throw new Error('Ambiguous or unsupported position response.');
 const [,x,y,z]=matches[0];const v={x:Number(x),y:Number(y),z:Number(z)};coords(v);return v;
}