export const QUICK_CHAT_CHOICES=[
  {
    "label": "Yes",
    "value": "d11_quick_chat_responses_slot_0"
  },
  {
    "label": "No",
    "value": "d11_quick_chat_responses_slot_1"
  },
  {
    "label": "OK",
    "value": "d11_quick_chat_responses_slot_2"
  },
  {
    "label": "Thank you",
    "value": "d11_quick_chat_responses_slot_3"
  },
  {
    "label": "No problem",
    "value": "d11_quick_chat_responses_slot_4"
  },
  {
    "label": "Hello",
    "value": "d11_quick_chat_responses_slot_5"
  },
  {
    "label": "Goodbye",
    "value": "d11_quick_chat_responses_slot_6"
  },
  {
    "label": "I'm sorry",
    "value": "d11_quick_chat_responses_slot_7"
  },
  {
    "label": "Follow me",
    "value": "d11_quick_chat_orders_slot_0"
  },
  {
    "label": "Go away",
    "value": "d11_quick_chat_orders_slot_1"
  },
  {
    "label": "Wait here",
    "value": "d11_quick_chat_orders_slot_3"
  },
  {
    "label": "Come in",
    "value": "d11_quick_chat_orders_slot_4"
  },
  {
    "label": "Let's go",
    "value": "d11_quick_chat_orders_slot_5"
  },
  {
    "label": "Hurry up",
    "value": "d11_quick_chat_orders_slot_7"
  },
  {
    "label": "I need wood",
    "value": "d11_quick_chat_i_need_phrase_format wood"
  },
  {
    "label": "I need stone",
    "value": "d11_quick_chat_i_need_phrase_format stones"
  }
];
export const DEFAULT_REGISTRATION={seconds:120,mode:'discord',joinEmote:'d11_quick_chat_responses_slot_5',leaveEmote:'d11_quick_chat_responses_slot_6',sayMessage:'{event.name} registration is OPEN! Use {join.emote} in SERVER Quick Chat to join, or {leave.emote} to leave.',sayClosedMessage:'{event.name} registration is closed. {event.players} participants.'};
export function registrationSettings(params:Record<string,unknown>){return {...DEFAULT_REGISTRATION,...params} as typeof DEFAULT_REGISTRATION;}
export function validateRegistration(params:Record<string,unknown>){const p=registrationSettings(params);const errors:string[]=[];if(!['discord','game','both'].includes(p.mode))errors.push('Invalid registration mode.');if(p.mode!=='discord'){if(!QUICK_CHAT_CHOICES.some(c=>c.value===p.joinEmote)||!QUICK_CHAT_CHOICES.some(c=>c.value===p.leaveEmote)||p.joinEmote===p.leaveEmote)errors.push('Choose two different supported Quick Chat emotes.');for(const text of [p.sayMessage,p.sayClosedMessage])if(typeof text!=='string'||text.length<1||text.length>400||/["\\;\x00-\x1f]/.test(text))errors.push('In-game announcements must be 1–400 characters, without quotes, semicolons or control characters.');}return errors;}
export function emoteLabel(value:string){return QUICK_CHAT_CHOICES.find(c=>c.value===value)?.label||'Unknown';}
export function quickChatAction(params:Record<string,unknown>,payload:{type?:unknown;message?:unknown}){const p=registrationSettings(params);if(p.mode==='discord'||payload.type!=='SERVER')return null;return payload.message===p.joinEmote?'join':payload.message===p.leaveEmote?'leave':null;}
export function safeSay(message:string){const clean=message.replace(/["\\;\x00-\x1f]/g,' ').trim().slice(0,400);if(!clean)throw Error('Empty in-game announcement.');return 'say "'+clean+'"';}
