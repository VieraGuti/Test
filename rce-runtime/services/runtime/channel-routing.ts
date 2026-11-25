// Port of the channel-type pattern in KING3X src/commands/admin-channels.js.
export const CHANNEL_CATALOG = [
 ['kills','Player Kills'],['player_activity','Player Joins & Leaves'],['events','Server Events'],['economy','Economy Transactions'],['admin','Admin Actions'],['user_actions','User Actions (Kits, Vehicles, Shop)'],['server_chat','Server Chat'],['staff','Staff In-Game Names'],['kit_claim','Kit Claims'],['zorp','ZORP Zones'],['raid_alerts','Raid Alerts'],['rider_log','Vehicle Claims'],['link_panel','Link Panel'],['clan_panel','Clan Panel'],['parser','Parser'],['fallout','Fallout'],['tickets_output','Tickets Output'],['leaderboard','Kill Leaderboard'],['ddos_alerts','Attack Alerts'],['heatmap','Heatmap'],['general','General Notifications']
] as const;
export const ACTIVE_ROUTES=['kills','events'] as const;
export type ActiveRoute=typeof ACTIVE_ROUTES[number];
export type ChannelRoutes=Partial<Record<ActiveRoute,string>>;
export function validateRoute(type:unknown,id:unknown):type is ActiveRoute{
 return ACTIVE_ROUTES.some(t=>t===type)&&typeof id==='string'&&/^\d{17,20}$/.test(id);
}
export function readRoutes(value:unknown):ChannelRoutes{
 const out:ChannelRoutes={};
 if(!value||typeof value!=='object')return out;
 for(const type of ACTIVE_ROUTES){const id=(value as Record<string,unknown>)[type];if(validateRoute(type,id))out[type]=String(id);}
 return out;
}
export function resolveRoute(routes:unknown,type:ActiveRoute,fallback?:unknown):string|undefined{
 const selected=readRoutes(routes)[type];return selected||(typeof fallback==='string'&&/^\d{17,20}$/.test(fallback)?fallback:undefined);
}
