import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.185.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.185.0/examples/jsm/loaders/GLTFLoader.js';
import { OBSTACLES, DECOR } from '/shared/map.js';

const loader=new GLTFLoader();
const ASSETS={
  rifle:'https://cdn.jsdelivr.net/gh/petroulacl/fps-asset-kit@main/weapons/flat_guns_west/Flat%20Guns%20West/GLB/Rifle_Assault_West.glb',
  small:'https://cdn.jsdelivr.net/gh/anshaneja5/skyline-run@main/public/assets/models/b_small.glb',
  medium:'https://cdn.jsdelivr.net/gh/anshaneja5/skyline-run@main/public/assets/models/b_medium.glb',
  large:'https://cdn.jsdelivr.net/gh/anshaneja5/skyline-run@main/public/assets/models/b_large.glb',
  bush:'https://cdn.jsdelivr.net/gh/anshaneja5/skyline-run@main/public/assets/models/bush.glb',
  ac:'https://cdn.jsdelivr.net/gh/anshaneja5/skyline-run@main/public/assets/models/prop_ac.glb'
};

function load(url){return new Promise((ok,no)=>loader.load(url,g=>ok(g.scene),undefined,no))}
function status(text){
  let el=document.getElementById('asset-status');
  if(!el){el=document.createElement('div');el.id='asset-status';Object.assign(el.style,{position:'fixed',left:'50%',bottom:'18px',transform:'translateX(-50%)',zIndex:99,padding:'8px 12px',borderRadius:'8px',background:'rgba(0,0,0,.68)',color:'#fff',font:'700 11px system-ui',pointerEvents:'none'});document.body.appendChild(el)}
  el.textContent=text;clearTimeout(status.t);status.t=setTimeout(()=>el.remove(),3500);
}
function fit(proto,o){
  const g=proto.clone(true),box=new THREE.Box3().setFromObject(g),sz=new THREE.Vector3(),c=new THREE.Vector3();box.getSize(sz);box.getCenter(c);
  g.position.sub(c);
  if(sz.x&&sz.y&&sz.z)g.scale.set(o.w/sz.x,o.h/sz.y,o.d/sz.z);
  g.position.set(o.x,o.h/2,o.z);
  g.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;if(n.material){n.material=n.material.clone();if(n.material.color)n.material.color.multiply(new THREE.Color(1.04,.90,.72));n.material.roughness=Math.max(.62,n.material.roughness??.8)}}});
  return g;
}
function findPlaceholder(scene,o){
  let best=null,bd=1e9;
  scene.traverse(n=>{
    if(!n.isMesh||!n.geometry?.isBoxGeometry)return;
    const d=Math.abs(n.position.x-o.x)+Math.abs(n.position.z-o.z)+Math.abs(n.position.y-o.h/2);
    if(d<bd){bd=d;best=n}
  });
  return bd<.3?best:null;
}
function normalizeRifle(g){
  const box=new THREE.Box3().setFromObject(g),sz=new THREE.Vector3(),c=new THREE.Vector3();box.getSize(sz);box.getCenter(c);g.position.sub(c);
  const axes=[['x',sz.x],['y',sz.y],['z',sz.z]].sort((a,b)=>b[1]-a[1]);const longest=axes[0][1]||1;g.scale.setScalar(1.08/longest);
  if(axes[0][0]==='x')g.rotation.y=Math.PI/2;else if(axes[0][0]==='y')g.rotation.x=Math.PI/2;
  g.traverse(n=>{if(n.isMesh){n.castShadow=false;n.receiveShadow=false}});
}
async function enhance(scene,camera){
  status('Cargando edificios + rifle CC0…');
  try{
    const [rifle,small,medium,large,bush,ac]=await Promise.all(Object.values(ASSETS).map(load));
    scene.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true}});

    const vm=camera.children.find(c=>c.isGroup);
    normalizeRifle(rifle);
    if(vm){
      for(const ch of vm.children)ch.visible=false;
      rifle.position.set(.03,-.03,-.45);
      rifle.rotation.z=-.06;
      vm.add(rifle);
    }else{
      rifle.position.set(.36,-.30,-.75);camera.add(rifle);
    }

    const big=OBSTACLES.filter(o=>(o.kind==='sandstone')&&o.w>=7&&o.d>=6);
    big.forEach((o,i)=>{
      const old=findPlaceholder(scene,o);if(old)old.visible=false;
      const proto=i%3===0?large:(i%3===1?medium:small);
      scene.add(fit(proto,o));
    });
    DECOR.forEach((o,i)=>{
      const old=findPlaceholder(scene,o);if(old)old.visible=false;
      scene.add(fit(i%2?medium:large,o));
    });

    const props=[[-30,17],[30,17],[-24,28],[24,28],[-5,18],[6,18],[-20,-21],[20,-21],[-36,8],[36,8]];
    props.forEach(([x,z],i)=>{
      const p=(i%3===0?ac:bush).clone(true),b=new THREE.Box3().setFromObject(p),s=new THREE.Vector3();b.getSize(s);
      p.scale.setScalar(s.y?1.15/s.y:1);p.position.set(x,.04,z);p.rotation.y=(i*.73)%6.28;
      p.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true}});scene.add(p);
    });
    status('✓ MODELOS REALES CARGADOS');
  }catch(e){console.error(e);status('Falló un asset externo · recarga la página')}
}
let done=false;
const original=THREE.WebGLRenderer.prototype.render;
THREE.WebGLRenderer.prototype.render=function(scene,camera){
  if(!done&&scene&&camera){done=true;queueMicrotask(()=>enhance(scene,camera))}
  return original.call(this,scene,camera);
};
await import('/main.js?v=dust-cc0-2');
