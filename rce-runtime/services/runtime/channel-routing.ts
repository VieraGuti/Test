// Port of the channel-type pattern in KING3X src/commands/admin-channels.js.
export const CHANNEL_CATALOG = [
 ['kills','Player Kills'],['player_activity','Player Joins & Leaves'],['events','Server Events'],['economy','Economy Transactions'],['admin','Admin Actions'],['user_actions','User Actions (Kits, Vehicles, Shop)'],['server_chat','Server Chat'],['staff','Staff In-Game Names'],['kit_claim','Kit Claims'],['zorp','ZORP Zones'],['raid_alerts','Raid Alerts'],['rider_log','Vehicle Claims'],['link_panel','Link Panel'],['clan_panel','Clan Panel'],['parser','Parser'],['fallout','Fallout'],['tickets_output','Tickets Output'],['leaderboard','Kill Leaderboard'],['ddos_alerts','Attack Alerts'],['heatmap','Heatmap'],['general','General Notifications'],['shop','Shop Panel'],['welcome','Member Welcome'],['member_leave','Member Leave'],['clan_log','Clan Logs'],['event_results','Event Results'],['zorp_panel','ZORP Panel']
] as const;
export const ACTIVE_ROUTES=['kills','events'] as const;
export type ActiveRoute=typeof CHANNEL_CATALOG[number][0];
export type ChannelRoutes=Partial<Record<ActiveRoute,string>>;
export function validateRoute(type:unknown,id:unknown):type is ActiveRoute{
 return CHANNEL_CATALOG.some(t=>t[0]===type)&&typeof id==='string'&&/^\d{17,20}$/.test(id);
}
export function readRoutes(value:unknown):ChannelRoutes{
 const out:ChannelRoutes={};
 if(!value||typeof value!=='object')return out;
 for(const [type] of CHANNEL_CATALOG){const id=(value as Record<string,unknown>)[type];if(validateRoute(type,id))out[type]=String(id);}
 return out;
}
export function resolveRoute(routes:unknown,type:ActiveRoute,fallback?:unknown):string|undefined{
 const selected=readRoutes(routes)[type];return selected||(typeof fallback==='string'&&/^\d{17,20}$/.test(fallback)?fallback:undefined);
}

export const SETUP_GROUPS=[{name:'WIPESIDE · GAME',keys:['kills','player_activity','leaderboard','server_chat','raid_alerts','heatmap','ddos_alerts']},{name:'WIPESIDE · ECONOMY',keys:['shop','economy','kit_claim','rider_log','user_actions']},{name:'WIPESIDE · COMMUNITY',keys:['welcome','member_leave','link_panel','clan_panel','clan_log','zorp_panel','general']},{name:'WIPESIDE · EVENTS',keys:['events','event_results','fallout']},{name:'WIPESIDE · STAFF',keys:['admin','staff','zorp','parser','tickets_output']}] as const;
export function routeName(key:string){return key.replaceAll('_','-');}
