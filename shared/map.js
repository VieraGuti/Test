export const WORLD = Object.freeze({ half: 30, playerRadius: 0.45 });
export const SITES = Object.freeze({ A: { x: -10, z: 10, radius: 4.2 }, B: { x: 12, z: -11, radius: 4.2 } });
export const SPAWNS = Object.freeze({
  attackers: [{ x: -23, z: -5 }, { x: -24, z: -2 }, { x: -22, z: 1 }, { x: -24, z: 4 }, { x: -21, z: 6 }],
  defenders: [{ x: 23, z: 5 }, { x: 24, z: 2 }, { x: 22, z: -1 }, { x: 24, z: -4 }, { x: 21, z: -6 }]
});
export const OBSTACLES = Object.freeze([
  { x: 0, z: 0, w: 4, d: 16, h: 3 }, { x: -12, z: -2, w: 7, d: 4, h: 3 }, { x: 12, z: 3, w: 8, d: 4, h: 3 },
  { x: -4, z: 14, w: 9, d: 3, h: 3 }, { x: 7, z: -15, w: 10, d: 3, h: 3 }, { x: -19, z: 11, w: 3, d: 9, h: 3 },
  { x: 19, z: -9, w: 3, d: 9, h: 3 }, { x: -4, z: -11, w: 5, d: 5, h: 2 }, { x: 6, z: 11, w: 5, d: 5, h: 2 }
]);
export function insideSite(x, z) { for (const [name, s] of Object.entries(SITES)) if (Math.hypot(x - s.x, z - s.z) <= s.radius) return name; return ''; }
export function collides(x, z, radius = WORLD.playerRadius) {
  if (Math.abs(x) > WORLD.half - radius || Math.abs(z) > WORLD.half - radius) return true;
  for (const o of OBSTACLES) { const minX=o.x-o.w/2-radius,maxX=o.x+o.w/2+radius,minZ=o.z-o.d/2-radius,maxZ=o.z+o.d/2+radius; if (x>minX&&x<maxX&&z>minZ&&z<maxZ) return true; }
  return false;
}
