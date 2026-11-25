import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID,randomBytes} from 'node:crypto';
import {verifySignature,botIdentity,isPublicIPv4} from './guards.ts';
import {encrypt,decrypt} from '../../server/security.ts';
import {commands,parsePosition} from '../../core/commands.ts';
import {simulate} from '../../core/engine.ts';
test('service signatures and UUID identity',()=>{const key='test-only';const stamp=String(Date.now()),nonce=randomUUID(),body='{}';const signature=createHmac('sha256',key).update(stamp+'.'+nonce+'.'+body).digest('hex');assert(verifySignature(key,stamp,nonce,body,signature));assert(!verifySignature(key,stamp,nonce,'altered',signature));assert(!verifySignature(key,stamp,nonce,body,'x'.repeat(64)));const id=randomUUID(),tenant=randomUUID();assert.deepEqual(botIdentity(tenant,id),{tenantId:tenant,id});assert.throws(()=>botIdentity('invalid',id));});
test('private addresses rejected',()=>{for(const ip of ['127.0.0.1','10.1.2.3','192.168.0.1','169.254.169.254','100.64.0.1'])assert(!isPublicIPv4(ip));assert(isPublicIPv4('8.8.8.8'));});
test('authenticated encryption',async()=>{const key=randomBytes(32).toString('base64');const encrypted=await encrypt('test secret',key,'tenant:bot');assert.equal(await decrypt(encrypted,key,'tenant:bot'),'test secret');await assert.rejects(decrypt(encrypted,key,'other:bot'));});
test('RCON command arguments and positions',()=>{assert.throws(()=>commands.position('a";quit'));assert.deepEqual(parsePosition('Player1: (1,2,3)','Player1'),{x:1,y:2,z:3});assert.throws(()=>parsePosition('Player2: (1,2,3)','Player1'));});
test('event engine completes a bounded safe simulation',async()=>{const d={schemaVersion:1,name:'Smoke',description:'Smoke',category:'Test',maxPlayers:2,arena:{x:0,y:20,z:0},nodes:[{id:'start',kind:'event.started',label:'Start',position:{x:0,y:0},params:{}},{id:'end',kind:'event.end',label:'End',position:{x:1,y:0},params:{}}],edges:[{id:'e',source:'start',target:'end'}],embed:{title:'Smoke',description:'Smoke',color:'#112233',footer:'',image:'',thumbnail:''}};const result=await simulate(d,{seed:42,players:2});assert.equal(result.report.passed,true);});
import {readFile} from 'node:fs/promises';
import {validateDefinition} from '../../core/validation.ts';
test('five event templates validate and complete simulated return paths',async()=>{const templates=JSON.parse(await readFile(new URL('../../core/event-templates.json',import.meta.url),'utf8'));assert.equal(templates.length,5);for(const d of templates){assert.deepEqual(validateDefinition(d),[],d.name);const result=await simulate(d,{seed:42,players:Math.min(4,d.maxPlayers)});assert.equal(result.report.passed,true,d.name+': '+result.report.errors.join('; '));assert.equal(result.report.pending,0,d.name);}});

import {NODE_PRESETS,presetNode,searchNodePresets} from '../../core/node-library.ts';
import {ACTIONS} from '../../core/catalog.ts';
test('node library presets are unique, searchable, and use supported parameters',()=>{assert.equal(new Set(NODE_PRESETS.map(p=>p.id)).size,NODE_PRESETS.length);assert.equal(new Set(NODE_PRESETS.map(p=>p.kind)).size,ACTIONS.length);for(const p of NODE_PRESETS){const n=presetNode(p.id,'test-node',{x:0,y:0});const action=ACTIONS.find(a=>a.kind===n.kind)!;assert(action);assert.deepEqual(Object.keys(n.params).sort(),Object.keys(action.params).sort());}assert(searchNodePresets('wolf').some(p=>p.id==='wolves'));assert(searchNodePresets('medical kit').some(p=>p.id==='medic-kit'));assert.equal(searchNodePresets('zzzzzzzzz').length,0);});
