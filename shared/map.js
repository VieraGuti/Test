export const WORLD = Object.freeze({ half: 46, playerRadius: 0.45 });

export const SITES = Object.freeze({
  A: { x: 27, z: 24, radius: 4.6 },
  B: { x: -27, z: 20, radius: 4.6 }
});

export const SPAWNS = Object.freeze({
  attackers: [
    { x: -4, z: -38 }, { x: -2, z: -39 }, { x: 0, z: -38 }, { x: 2, z: -39 }, { x: 4, z: -38 }
  ],
  defenders: [
    { x: -4, z: 38 }, { x: -2, z: 39 }, { x: 0, z: 38 }, { x: 2, z: 39 }, { x: 4, z: 38 }
  ]
});

// Original Dust-style layout built from simple primitives. Extra metadata is ignored by
// server collision code but used by the web client for materials and visual landmarks.
export const OBSTACLES = Object.freeze([
  // T spawn buildings / exits
  { x: -16, z: -34, w: 18, d: 8, h: 6, kind: 'sandstone' },
  { x: 17, z: -34, w: 18, d: 8, h: 6, kind: 'sandstone' },
  { x: -7, z: -25, w: 9, d: 7, h: 5, kind: 'sandstone' },
  { x: 8, z: -25, w: 10, d: 7, h: 5, kind: 'sandstone' },

  // Mid buildings with a clear central lane
  { x: -15, z: -10, w: 16, d: 15, h: 7, kind: 'sandstone' },
  { x: 16, z: -9, w: 16, d: 15, h: 7, kind: 'sandstone' },
  { x: -16, z: 8, w: 14, d: 12, h: 6, kind: 'sandstone' },
  { x: 17, z: 9, w: 14, d: 11, h: 6, kind: 'sandstone' },

  // Mid double-door frame + doors, leaving a playable slit in the middle
  { x: -4.6, z: 1, w: 3.2, d: 1.1, h: 4.8, kind: 'door' },
  { x: 4.6, z: 1, w: 3.2, d: 1.1, h: 4.8, kind: 'door' },
  { x: -7.7, z: 1, w: 2.4, d: 3.4, h: 5.6, kind: 'sandstone' },
  { x: 7.7, z: 1, w: 2.4, d: 3.4, h: 5.6, kind: 'sandstone' },

  // B tunnels / upper B route on the west side
  { x: -38, z: -4, w: 4, d: 28, h: 5.5, kind: 'tunnel' },
  { x: -27, z: -3, w: 4, d: 24, h: 5.5, kind: 'tunnel' },
  { x: -34, z: 13, w: 12, d: 4, h: 5, kind: 'sandstone' },
  { x: -22, z: 16, w: 5, d: 9, h: 5.5, kind: 'sandstone' },

  // A long route on the east side
  { x: 38, z: -2, w: 4, d: 29, h: 6, kind: 'sandstone' },
  { x: 28, z: -2, w: 4, d: 23, h: 5.2, kind: 'sandstone' },
  { x: 34, z: 14, w: 11, d: 4, h: 5, kind: 'sandstone' },
  { x: 22, z: 17, w: 5, d: 8, h: 5.5, kind: 'sandstone' },

  // CT-side structures
  { x: -15, z: 32, w: 16, d: 9, h: 6.5, kind: 'sandstone' },
  { x: 15, z: 32, w: 16, d: 9, h: 6.5, kind: 'sandstone' },
  { x: 0, z: 24, w: 10, d: 6, h: 5, kind: 'sandstone' },

  // B site cover / boxes
  { x: -31.5, z: 22.5, w: 2.8, d: 2.8, h: 2.8, kind: 'crate' },
  { x: -28.1, z: 23.1, w: 2.5, d: 2.5, h: 2.5, kind: 'crate' },
  { x: -23.4, z: 18.2, w: 3.2, d: 2.3, h: 2.2, kind: 'crate' },
  { x: -33.5, z: 18.2, w: 2.3, d: 4.8, h: 2.3, kind: 'crate' },

  // A site cover / boxes
  { x: 30.8, z: 25.2, w: 3.0, d: 3.0, h: 3.0, kind: 'crate' },
  { x: 26.8, z: 28.2, w: 2.5, d: 4.0, h: 2.5, kind: 'crate' },
  { x: 22.7, z: 22.8, w: 3.2, d: 2.2, h: 2.2, kind: 'crate' },
  { x: 33.5, z: 20.0, w: 2.5, d: 5.0, h: 2.4, kind: 'crate' },

  // Mid cover / catwalk feel
  { x: -5.5, z: 13.5, w: 3.5, d: 3.5, h: 2.4, kind: 'crate' },
  { x: 6.0, z: 15.5, w: 3.0, d: 3.0, h: 2.2, kind: 'crate' },
  { x: 0, z: -16.5, w: 4.0, d: 2.2, h: 2.0, kind: 'crate' }
]);

export const DECOR = Object.freeze([
  { x: -42, z: 30, w: 5, d: 18, h: 9, kind: 'distant' },
  { x: 42, z: 29, w: 5, d: 19, h: 10, kind: 'distant' },
  { x: -42, z: -30, w: 5, d: 18, h: 8, kind: 'distant' },
  { x: 42, z: -31, w: 5, d: 18, h: 8, kind: 'distant' },
  { x: -24, z: 42, w: 15, d: 5, h: 9, kind: 'distant' },
  { x: 25, z: 42, w: 15, d: 5, h: 8, kind: 'distant' }
]);

export function insideSite(x, z) {
  for (const [name, s] of Object.entries(SITES)) {
    if (Math.hypot(x - s.x, z - s.z) <= s.radius) return name;
  }
  return '';
}

export function collides(x, z, radius = WORLD.playerRadius) {
  if (Math.abs(x) > WORLD.half - radius || Math.abs(z) > WORLD.half - radius) return true;
  for (const o of OBSTACLES) {
    const minX = o.x - o.w / 2 - radius;
    const maxX = o.x + o.w / 2 + radius;
    const minZ = o.z - o.d / 2 - radius;
    const maxZ = o.z + o.d / 2 + radius;
    if (x > minX && x < maxX && z > minZ && z < maxZ) return true;
  }
  return false;
}
