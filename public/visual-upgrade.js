import * as THREE from 'https://esm.sh/three@0.185.0';
import { GLTFLoader } from 'https://esm.sh/three@0.185.0/examples/jsm/loaders/GLTFLoader.js';
import { OBSTACLES, DECOR, SITES } from '/shared/map.js';

const BUILD='VIERASTRIKE_VISUAL_V5_2026-09-12';
const KBUILD='https://cdn.jsdelivr.net/gh/petroulacl/fps-buildings-env-kit@main/buildings/kenney-modular-buildings/Models/GLB%20format/';
const SURV='https://cdn.jsdelivr.net/gh/euuuuuuan/fatal-funnel-public@main/packages/renderer/assets/models/kenney-survival/';
const WEST='https://cdn.jsdelivr.net/gh/petroulacl/fps-asset-kit@main/weapons/flat_guns_west/Flat%20Guns%20West/GLB/';

const nativeLoad=GLTFLoader.prototype.load;
const weaponRedirects=[
 ['Pistol_Compact_East.glb',WEST+'Pistol_Compact_West.glb'],
 ['SMG_Compact_East.glb',WEST+'SMG_Compact_West.glb'],
 ['Rifle_Assault_East.glb',WEST+'Rifle_Assault_West.glb'],
 ['Sniper_Rifle_East.glb',WEST+'Sniper_Rifle_West.glb']
];
GLTFLoader.prototype.load=function(url,onLoad,onProgress,onError){
 let resolved=String(url||''),weapon=false;
 for(const [needle,replacement] of weaponRedirects){if(resolved.includes(needle)){resolved=replacement;weapon=true;break}}
 const wrapped=weapon&&onLoad?(gltf=>{gltf.scene.traverse(o=>{if(!o.isMesh)return;const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){if(!m)continue;if(m.color)m.color.multiplyScalar(.72);if('metalness'in m)m.metalness=Math.max(.18,Math.min(.55,m.metalness??.3));if('roughness'in m)m.roughness=Math.max(.38,m.roughness??.55)}});onLoad(gltf)}):onLoad;
 return nativeLoad.call(this,resolved,wrapped,onProgress,onError)
};

const cache=new Map();
function template(url){if(!cache.has(url))cache.set(url,new Promise((resolve,reject)=>{const l=new GLTFLoader();nativeLoad.call(l,url,g=>resolve(g.scene),undefined,reject)}));return cache.get(url)}
function tune(root,cast=false){root.traverse(o=>{if(!o.isMesh)return;o.castShadow=cast;o.receiveShadow=true;const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){if(!m)continue;if('roughness'in m)m.roughness=Math.max(.62,m.roughness??.7);if('metalness'in m)m.metalness=Math.min(.35,m.metalness??.08);if(m.map){m.map.anisotropy=2;m.map.colorSpace=THREE.SRGBColorSpace}}});return root}
async function addFitted(scene,url,spec){try{const src=await template(url),root=tune(src.clone(true),spec.cast??false);root.rotation.y=spec.rot||0;root.updateMatrixWorld(true);let box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3());const tx=Math.max(.08,spec.w||size.x),ty=Math.max(.08,spec.h||size.y),tz=Math.max(.08,spec.d||size.z);let s=Math.min(tx/Math.max(size.x,.001),ty/Math.max(size.y,.001),tz/Math.max(size.z,.001));s*=spec.fill||.94;root.scale.setScalar(s);root.updateMatrixWorld(true);box=new THREE.Box3().setFromObject(root);const c=box.getCenter(new THREE.Vector3());root.position.x+=(spec.x||0)-c.x;root.position.z+=(spec.z||0)-c.z;root.position.y+=(spec.y||0)-box.min.y;root.userData.vieraAsset=true;scene.add(root);return root}catch(e){console.warn('[VieraStrike V5] asset failed',url,e);return null}}

function noiseTexture(base='#b89a70',variation=18,size=96){const c=document.createElement('canvas');c.width=c.height=size;const x=c.getContext('2d');x.fillStyle=base;x.fillRect(0,0,size,size);const img=x.getImageData(0,0,size,size),d=img.data;for(let i=0;i<d.length;i+=4){const n=(Math.random()-.5)*variation;d[i]=Math.max(0,Math.min(255,d[i]+n));d[i+1]=Math.max(0,Math.min(255,d[i+1]+n));d[i+2]=Math.max(0,Math.min(255,d[i+2]+n))}x.putImageData(img,0,0);for(let i=0;i<34;i++){x.fillStyle=`rgba(62,45,29,${.015+Math.random()*.025})`;x.beginPath();x.arc(Math.random()*size,Math.random()*size,.4+Math.random()*1.5,0,Math.PI*2);x.fill()}const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(14,14);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=2;return t}
const mats={
 ground:new THREE.MeshStandardMaterial({map:noiseTexture('#bca77f',14),color:0xcab78e,roughness:1}),
 stuccoA:new THREE.MeshStandardMaterial({map:noiseTexture('#b99b72',10),color:0xc5a87d,roughness:.98}),
 stuccoB:new THREE.MeshStandardMaterial({map:noiseTexture('#9e805f',10),color:0xb0936d,roughness:.98}),
 tunnel:new THREE.MeshStandardMaterial({map:noiseTexture('#6f6251',8),color:0x756958,roughness:1}),
 trim:new THREE.MeshStandardMaterial({color:0xd5c294,roughness:.9}),
 door:new THREE.MeshStandardMaterial({color:0x4d3627,roughness:.82,metalness:.08}),
 road:new THREE.MeshStandardMaterial({map:noiseTexture('#857b6d',10),color:0x8e8373,roughness:1}),
 crate:new THREE.MeshStandardMaterial({color:0x6f5138,roughness:.9})
};

function obstacleAt(x,z){return OBSTACLES.find(o=>Math.abs(o.x-x)<.08&&Math.abs(o.z-z)<.08)}
function restyleLegacy(scene){scene.traverse(o=>{
  if(o.userData.vieraAsset)return;
  if(o.isLineSegments){o.visible=false;return}
  if(!o.isMesh)return;
  const type=o.geometry?.type,p=o.geometry?.parameters||{};
  if(type==='PlaneGeometry'&&(p.width||0)>80&&(p.height||0)>80){o.material=mats.ground;o.receiveShadow=true;return}
  if(type!=='BoxGeometry')return;
  const obs=obstacleAt(o.position.x,o.position.z);
  if(obs?.kind==='crate'){o.visible=false;return}
  if(obs?.kind==='door'){o.visible=false;return}
  if(obs?.kind==='tunnel'){o.material=mats.tunnel;return}
  if((p.height||0)<=.3){o.material=mats.trim;return}
  if((p.height||0)>=4){o.material=(o.position.x+o.position.z)%2>0?mats.stuccoA:mats.stuccoB;return}
  if((p.height||0)<=3.4)o.material=mats.crate;
 })}

function addSky(scene){const geo=new THREE.SphereGeometry(150,20,12),mat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:new THREE.Color(0x5a8eac)},mid:{value:new THREE.Color(0xb8cbd0)},low:{value:new THREE.Color(0xe6c993)}},vertexShader:'varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec3 v;uniform vec3 top;uniform vec3 mid;uniform vec3 low;void main(){float h=normalize(v).y;vec3 c=mix(mid,top,smoothstep(.08,.78,h));c=mix(low,c,smoothstep(-.16,.06,h));gl_FragColor=vec4(c,1.0);}'});const sky=new THREE.Mesh(geo,mat);sky.userData.vieraAsset=true;scene.add(sky);const sun=new THREE.Mesh(new THREE.CircleGeometry(4.2,20),new THREE.MeshBasicMaterial({color:0xffe4aa,transparent:true,opacity:.5,depthWrite:false}));sun.position.set(-62,58,-116);sun.lookAt(0,13,0);sun.userData.vieraAsset=true;scene.add(sun)}

function routePlane(scene,x,z,w,d,shade=0){const m=mats.road.clone();m.color.offsetHSL(0,0,shade);const q=new THREE.Mesh(new THREE.PlaneGeometry(w,d),m);q.rotation.x=-Math.PI/2;q.position.set(x,.014,z);q.receiveShadow=true;q.userData.vieraAsset=true;scene.add(q)}
function addRoutes(scene){routePlane(scene,0,-9,8,52,.03);routePlane(scene,0,-34,40,7,.01);routePlane(scene,0,25,44,7,.02);routePlane(scene,-32,-2,7,31,-.03);routePlane(scene,-29,16,15,6,-.01);routePlane(scene,32,-2,7,32,.01);routePlane(scene,29,16,15,6,.02);routePlane(scene,-18,4,16,5,-.02);routePlane(scene,18,4,16,5,.02)}

function siteDecal(scene,name,s){const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d'),color=name==='A'?'#d9663a':'#3e83c8';x.clearRect(0,0,256,256);x.strokeStyle=color;x.lineWidth=18;x.beginPath();x.arc(128,128,93,0,Math.PI*2);x.stroke();x.fillStyle=color;x.font='900 128px system-ui';x.textAlign='center';x.textBaseline='middle';x.fillText(name,128,137);const t=new THREE.CanvasTexture(c),m=new THREE.MeshBasicMaterial({map:t,transparent:true,opacity:.78,depthWrite:false});const p=new THREE.Mesh(new THREE.PlaneGeometry(4.7,4.7),m);p.rotation.x=-Math.PI/2;p.position.set(s.x,.035,s.z);p.userData.vieraAsset=true;scene.add(p)}

async function addArchitecture(scene){
 const skyline=[[-43,31,'building-sample-tower-a.glb',0],[-43,-28,'building-sample-tower-c.glb',Math.PI],[43,30,'building-sample-tower-b.glb',Math.PI],[43,-29,'building-sample-tower-d.glb',0],[-24,44,'building-sample-house-b.glb',0],[25,44,'building-sample-house-c.glb',Math.PI]];
 await Promise.all(skyline.map(([x,z,file,rot],i)=>addFitted(scene,KBUILD+file,{x,z,w:i<4?7:13,h:i<4?9:7,d:i<4?7:6,rot,fill:.96})));
 const facades=[
 ['building-window-awnings.glb',-6.95,1,-25,7.5,3.2,.75,0],['building-window-balcony.glb',7.9,1,-25,7,3.1,.75,0],
 ['building-windows-sills.glb',-7.05,1.2,-10,7.5,3.4,.72,Math.PI/2],['building-windows-round.glb',8.05,1.2,-9,7.2,3.4,.72,-Math.PI/2],
 ['building-window-awnings.glb',-15,1.1,27.45,7.2,3.2,.7,Math.PI],['building-window-balcony.glb',15,1.1,27.45,7.2,3.2,.7,Math.PI],
 ['building-windows.glb',-28.95,1.1,-3,6.2,3.1,.72,Math.PI/2],['building-windows.glb',28.95,1.1,-2,6.2,3.1,.72,-Math.PI/2],
 ['detail-ac-a.glb',-11.5,3.8,-17.48,1.2,1,.65,0],['detail-ac-b.glb',19,3.8,-16.48,1.3,1,.65,0],
 ['roof-flat-awning-a.glb',-16,5.7,-29.5,8,.7,2.4,0],['roof-flat-awning-b.glb',17,5.7,-29.5,8,.7,2.4,0]
 ];
 await Promise.all(facades.map(([file,x,y,z,w,h,d,rot])=>addFitted(scene,KBUILD+file,{x,y,z,w,h,d,rot,fill:.92})));
 const doors=OBSTACLES.filter(o=>o.kind==='door');
 await Promise.all(doors.map(o=>addFitted(scene,KBUILD+'door-brown.glb',{x:o.x,y:.06,z:o.z-.08,w:o.w*.82,h:o.h*.91,d:.42,rot:0,fill:.95})));
}

async function addCollisionProps(scene){
 const crates=OBSTACLES.filter(o=>o.kind==='crate');
 await Promise.all(crates.map((o,i)=>addFitted(scene,SURV+(i%3===0?'box.glb':'box-large.glb'),{x:o.x,y:0,z:o.z,w:o.w*.96,h:o.h*.96,d:o.d*.96,rot:i%2?Math.PI/2:0,fill:.96,cast:false})));
 const barrels=[[-34.1,20.1],[-25.1,20.9],[34,22],[23.4,25.6]];
 await Promise.all(barrels.map(([x,z],i)=>addFitted(scene,SURV+(i%2?'barrel-open.glb':'barrel.glb'),{x,y:0,z,w:.75,h:1.1,d:.75,rot:i*.8,fill:.95})));
}

function tuneViewmodel(camera){for(const g of camera.children){if(!g.isGroup||g.userData.vieraTuned)continue;let capsules=0;g.traverse(o=>{if(o.geometry?.type==='CapsuleGeometry')capsules++});if(capsules<2)continue;g.userData.vieraTuned=true;g.scale.setScalar(.76);g.position.set(.28,-.28,-.47);g.traverse(o=>{if(!o.isMesh)return;if(o.geometry?.type==='CapsuleGeometry'&&o.material?.color)o.material.color.set(0xa97859);if(o.geometry?.type==='SphereGeometry'&&o.material?.color)o.material.color.set(0x202425)})}}

function lights(scene,renderer){renderer.toneMappingExposure=1.02;renderer.setPixelRatio(Math.min(devicePixelRatio,matchMedia('(pointer: coarse)').matches?1.08:1.5));scene.background=new THREE.Color(0xa7c8d5);if(scene.fog){scene.fog.color.set(0xd0c3a7);scene.fog.near=72;scene.fog.far=118}scene.traverse(o=>{if(o.isHemisphereLight){o.color.set(0xdceeff);o.groundColor.set(0x65513b);o.intensity=1.12}if(o.isDirectionalLight){o.color.set(0xffe1ad);o.intensity=2.55;o.position.set(-29,44,-18);if(o.shadow?.mapSize){const mobile=matchMedia('(pointer: coarse)').matches;o.shadow.mapSize.set(mobile?512:768,mobile?512:768);o.shadow.bias=-.00012;o.shadow.normalBias=.035}}})}

async function install(scene,renderer,camera){if(scene.userData[BUILD])return;scene.userData[BUILD]=true;document.documentElement.dataset.vierastrikeBuild=BUILD;restyleLegacy(scene);lights(scene,renderer);tuneViewmodel(camera);addSky(scene);addRoutes(scene);for(const [name,s] of Object.entries(SITES))siteDecal(scene,name,s);await Promise.allSettled([addArchitecture(scene),addCollisionProps(scene)]);console.info(`[VieraStrike] ${BUILD} loaded`)}
const nativeRender=THREE.WebGLRenderer.prototype.render;
THREE.WebGLRenderer.prototype.render=function(scene,camera){if(scene?.isScene&&!scene.userData[BUILD])install(scene,this,camera);else if(camera)tuneViewmodel(camera);return nativeRender.call(this,scene,camera)};
window.__VIERASTRIKE_VISUAL_BUILD__=BUILD;
