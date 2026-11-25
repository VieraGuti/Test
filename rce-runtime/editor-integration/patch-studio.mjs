import fs from 'node:fs';
const edit=(file,change)=>{const before=fs.readFileSync(file,'utf8'),after=change(before);if(before===after)throw Error('No change: '+file);fs.writeFileSync(file,after);console.log('PATCH_OK '+file);};
const replace=(s,a,b)=>{if(!s.includes(a))throw Error('Missing expected source anchor: '+a.slice(0,100));return s.replace(a,b);};
edit('core/catalog.ts',s=>{s="import {DEFAULT_REGISTRATION} from './participation.ts';\n"+s;return replace(s,"params:{seconds:30}","params:{...DEFAULT_REGISTRATION,seconds:30}");});
edit('core/validation.ts',s=>{s="import {validateRegistration} from './participation.ts';\n"+s;const a="errors.push(...validateSpatial(d));";return replace(s,a,a+"\n for(const n of d.nodes)if(n.kind==='registration.open'&&n.params&&typeof n.params==='object')errors.push(...validateRegistration(n.params));");});
edit('components/studio.tsx',s=>{
 s=replace(s,"import SpawnEditor from './spawn-editor';","import SpawnEditor from './spawn-editor';\nimport {NodeLibrary} from './node-library';\nimport {presetNode} from '@/core/node-library';");
 const start=s.indexOf('{palette&&<>');const stop=s.indexOf('</>}</aside>',start);if(start<0||stop<0)throw Error('Original palette boundaries missing.');
 const callback="(node)=>{const bounds=canvasRef.current?.getBoundingClientRect();const position=bounds?flow.screenToFlowPosition({x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2}):node.position;onChange({...d,nodes:[...d.nodes,{...node,position}]});setSelected(node.id);}";
 s=s.slice(0,start)+'{palette&&<NodeLibrary onAdd={'+callback+'} onDragStart={()=>{}}/>}'+s.slice(stop+4);
 const drop="const kind=e.dataTransfer.getData('application/rce-node');if(ACTIONS.some(a=>a.kind===kind))add(kind,flow.screenToFlowPosition({x:e.clientX,y:e.clientY}));";
 s=replace(s,drop,"const preset=e.dataTransfer.getData('application/rce-node-preset');if(preset){const node=presetNode(preset,crypto.randomUUID(),flow.screenToFlowPosition({x:e.clientX,y:e.clientY}));onChange({...d,nodes:[...d.nodes,node]});setSelected(node.id);return;}"+drop);
 console.log('STUDIO_PATCH_PREVIEW '+JSON.stringify(s.slice(s.indexOf('NODE LIBRARY')-120,s.indexOf('NODE LIBRARY')+650)));
 const a=s.indexOf('const add=');if(a>=0)console.log('ORIGINAL_ADD '+JSON.stringify(s.slice(a,a+750)));
 const r=s.indexOf('Object.entries');if(r>=0)console.log('ORIGINAL_PARAMS '+JSON.stringify(s.slice(r-180,r+650)));
 return s;
});
const file='components/dashboard.tsx';let dash=fs.readFileSync(file,'utf8');const original=dash;
dash=dash.replace(/\{([\w]+)\.(servers|events)\}/g,(match,v,k)=>'{'+v+'.'+k+'>=2147483647?\'Unlimited\':'+v+'.'+k+'}');
if(dash!==original){fs.writeFileSync(file,dash);console.log('PATCH_OK '+file);}
for(const needle of ['monthlyPriceId','Choose ','plans.map','subscription.planId']){const i=dash.indexOf(needle);if(i>=0)console.log('PRICING_SOURCE '+needle+' '+JSON.stringify(dash.slice(Math.max(0,i-200),i+500)));}
