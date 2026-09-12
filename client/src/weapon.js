import * as THREE from 'three';
const FIRE_COOLDOWN=100;
export class Weapon{
  constructor(camera,scene,isMobile=false){
    this.camera=camera;this.scene=scene;this.isMobile=isMobile;this.lastFireTime=0;this.onShoot=null;
    const gunGroup=new THREE.Group();
    const shellMat=new THREE.MeshStandardMaterial({color:0x1a1a2e,roughness:.2,metalness:.9});
    const accentMat=new THREE.MeshStandardMaterial({color:0x2d1b4e,roughness:.3,metalness:.7});
    const glowMat=new THREE.MeshStandardMaterial({color:0x00ffcc,emissive:0x00ffcc,emissiveIntensity:.8,roughness:.1,metalness:.3});
    const glowCoreMat=new THREE.MeshStandardMaterial({color:0x00ff88,emissive:0x00ff88,emissiveIntensity:1.5,roughness:0,metalness:0});
    const bodyGeo=new THREE.CylinderGeometry(.06,.09,.5,6);bodyGeo.rotateX(Math.PI/2);const body=new THREE.Mesh(bodyGeo,shellMat);gunGroup.add(body);
    const ridgeGeo=new THREE.BoxGeometry(.04,.06,.45);const ridge=new THREE.Mesh(ridgeGeo,accentMat);ridge.position.set(0,.06,-.01);gunGroup.add(ridge);
    for(const[px,py]of[[0,.03],[.035,-.02],[-.035,-.02]]){const g=new THREE.CylinderGeometry(.015,.02,.28,5);g.rotateX(Math.PI/2);const p=new THREE.Mesh(g,shellMat);p.position.set(px,py,-.38);gunGroup.add(p);}
    const ringGeo=new THREE.TorusGeometry(.04,.01,6,6);ringGeo.rotateX(Math.PI/2);const ring=new THREE.Mesh(ringGeo,glowMat);ring.position.set(0,0,-.48);gunGroup.add(ring);
    const core=new THREE.Mesh(new THREE.SphereGeometry(.04,8,8),glowCoreMat);core.position.set(0,0,-.05);gunGroup.add(core);this.energyCore=core;
    for(const side of[-1,1]){const g=new THREE.CylinderGeometry(.008,.008,.35,4);g.rotateX(Math.PI/2);const vein=new THREE.Mesh(g,glowMat);vein.position.set(side*.07,0,-.05);gunGroup.add(vein);}
    const handle=new THREE.Mesh(new THREE.CylinderGeometry(.035,.03,.2,6),accentMat);handle.position.set(0,-.15,.08);handle.rotation.x=.25;gunGroup.add(handle);
    const handleGlow=new THREE.Mesh(new THREE.BoxGeometry(.01,.18,.015),glowMat);handleGlow.position.set(0,-.15,.065);handleGlow.rotation.x=.25;gunGroup.add(handleGlow);
    const gunGlow=new THREE.PointLight(0x00ffcc,.3,2);gunGlow.position.set(0,0,-.1);gunGroup.add(gunGlow);
    gunGroup.position.set(.3,-.25,-.5);this.gunModel=gunGroup;this.gunOriginalPos=gunGroup.position.clone();this.camera.add(gunGroup);
    this.flashLight=new THREE.PointLight(0x00ffaa,0,6);this.flashLight.position.set(0,0,-.55);gunGroup.add(this.flashLight);
    const flashMat=new THREE.MeshBasicMaterial({color:0x00ffcc,transparent:true,opacity:0});this.flashSprite=new THREE.Mesh(new THREE.PlaneGeometry(.18,.18),flashMat);this.flashSprite.position.set(0,0,-.58);gunGroup.add(this.flashSprite);
    this.pulseTime=0;this.recoilZ=0;this.recoilY=0;this.flashTimer=0;this.mouseHeld=false;
    this._onDown=(e)=>{if(e.button===0)this.mouseHeld=true;};this._onUp=(e)=>{if(e.button===0)this.mouseHeld=false;};
    document.addEventListener('pointerdown',this._onDown);document.addEventListener('pointerup',this._onUp);
  }
  fire(){const now=performance.now();if(now-this.lastFireTime<FIRE_COOLDOWN)return;this.lastFireTime=now;const origin=new THREE.Vector3(),direction=new THREE.Vector3();this.camera.getWorldPosition(origin);this.camera.getWorldDirection(direction);this.flashLight.intensity=4;this.flashSprite.material.opacity=1;this.flashTimer=.08;if(this.energyCore)this.energyCore.material.emissiveIntensity=4;this.recoilZ=.15;this.recoilY=.04;if(this.onShoot)this.onShoot({x:origin.x,y:origin.y,z:origin.z},{x:direction.x,y:direction.y,z:direction.z});}
  update(dt){if(this.mouseHeld&&!this.isMobile)this.fire();if(this.flashTimer>0){this.flashTimer-=dt;if(this.flashTimer<=0){this.flashLight.intensity=0;this.flashSprite.material.opacity=0;}}if(this.recoilZ>0){this.recoilZ-=dt*1.2;if(this.recoilZ<0)this.recoilZ=0;}if(this.recoilY>0){this.recoilY-=dt*.4;if(this.recoilY<0)this.recoilY=0;}this.gunModel.position.z=this.gunOriginalPos.z+this.recoilZ;this.gunModel.position.y=this.gunOriginalPos.y+this.recoilY;this.gunModel.rotation.x=-this.recoilY*3;this.pulseTime+=dt;if(this.energyCore){const pulse=.8+Math.sin(this.pulseTime*3)*.4;this.energyCore.material.emissiveIntensity=Math.max(pulse,this.energyCore.material.emissiveIntensity*.92);}}
  destroy(){document.removeEventListener('pointerdown',this._onDown);document.removeEventListener('pointerup',this._onUp);this.camera.remove(this.gunModel);}
}
