import { Schema, MapSchema, defineTypes } from '@colyseus/schema';
export class PlayerState extends Schema {
  constructor(){ super(); this.name='player'; this.team='attackers'; this.x=0; this.y=0; this.z=0; this.yaw=0; this.pitch=0; this.hp=100; this.armor=0; this.money=800; this.kills=0; this.deaths=0; this.alive=true; this.weapon='sidearm'; this.ammo=15; this.reserveAmmo=60; this.hasBomb=false; this.reloading=false; }
}
defineTypes(PlayerState,{ name:'string',team:'string',x:'number',y:'number',z:'number',yaw:'number',pitch:'number',hp:'number',armor:'number',money:'number',kills:'number',deaths:'number',alive:'boolean',weapon:'string',ammo:'number',reserveAmmo:'number',hasBomb:'boolean',reloading:'boolean' });
export class StrikeState extends Schema {
  constructor(){ super(); this.players=new MapSchema(); this.phase='waiting'; this.phaseEndsAt=0; this.round=0; this.attackersScore=0; this.defendersScore=0; this.roundWinner=''; this.reason=''; this.bombState='idle'; this.bombCarrier=''; this.bombX=0; this.bombZ=0; this.bombSite=''; this.bombExplodesAt=0; this.planter=''; this.plantProgress=0; this.defuser=''; this.defuseProgress=0; }
}
defineTypes(StrikeState,{ players:{map:PlayerState},phase:'string',phaseEndsAt:'number',round:'number',attackersScore:'number',defendersScore:'number',roundWinner:'string',reason:'string',bombState:'string',bombCarrier:'string',bombX:'number',bombZ:'number',bombSite:'string',bombExplodesAt:'number',planter:'string',plantProgress:'number',defuser:'string',defuseProgress:'number' });
