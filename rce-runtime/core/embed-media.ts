// Shared media contract for Wipeside Discord embeds and future modules.
export const EMBED_SCOPES=['default','kills','events','event-summary','bot-status','bot-channels'] as const;
export type EmbedScope=typeof EMBED_SCOPES[number];
export type EmbedMedia={image:string;thumbnail:string};
export const EMPTY_MEDIA:EmbedMedia={image:'',thumbnail:''};
export function validMediaUrl(v:unknown):v is string{if(typeof v!=='string'||v.length>1500)return false;if(v==='')return true;try{const u=new URL(v);return u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password&&!/[\u0000-\u001f\u007f\s]/.test(v);}catch{return false;}}
export function cleanMedia(v:unknown):EmbedMedia{const x=v&&typeof v==='object'?v as Record<string,unknown>:{};return {image:validMediaUrl(x.image)?x.image:'',thumbnail:validMediaUrl(x.thumbnail)?x.thumbnail:''};}
export function discordMedia(settings:unknown,scope:EmbedScope,event?:Partial<EmbedMedia>){const x=settings&&typeof settings==='object'?settings as Record<string,unknown>:{};const selected=x[scope]&&typeof x[scope]==='object'?cleanMedia(x[scope]):cleanMedia(x.default);const local=cleanMedia(event);const image=scope==='events'?local.image||selected.image:scope==='event-summary'&&!x[scope]?local.image||selected.image:selected.image;const thumbnail=scope==='events'?local.thumbnail||selected.thumbnail:scope==='event-summary'&&!x[scope]?local.thumbnail||selected.thumbnail:selected.thumbnail;return {...(image?{image:{url:image}}:{}),...(thumbnail?{thumbnail:{url:thumbnail}}:{})};}
