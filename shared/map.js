export const WORLD = Object.freeze({ half: 46, playerRadius: 0.45 });

export const SITES = Object.freeze({
  A: { x: 27, z: 24, radius: 4.6 },
  B: { x: -27, z: 20, radius: 4.6 }
});

export const SPAWNS = Object.freeze({
  attackers: [
    { x: -4, z: -39 }, { x: -2, z: -40 }, { x: 0, z: -39 }, { x: 2, z: -40 }, { x: 4, z: -39 }
  ],
  defenders: [
    { x: -4, z: 39 }, { x: -2, z: 40 }, { x: 0, z: 39 }, { x: 2, z: 40 }, { x: 4, z: 39 }
  ]
});

// VieraStrike layout v2: readable three-lane tactical map.
// South = Attackers. North = Defenders. Center = Mid. East = Long A. West = B tunnel.
export const OBSTACLES = Object.freeze([
  // T courtyard: central Mid exit + wide outside access to Long/Tunnel.
  { x: -18, z: -30.5, w: 18, d: 7, h: 6.2, kind: 'sandstone' },
  { x: 18, z: -30.5, w: 18, d: 7, h: 6.2, kind: 'sandstone' },

  // Lower Mid. The 18 m center lane is deliberately clean and readable.
  { x: -18, z: -15, w: 18, d: 14, h: 7, kind: 'sandstone' },
  { x: 18, z: -15, w: 18, d: 14, h: 7, kind: 'sandstone' },

  // Upper Mid / connector buildings.
  { x: -18, z: 4, w: 18, d: 16, h: 6.4, kind: 'sandstone' },
  { x: 18, z: 4, w: 18, d: 16, h: 6.4, kind: 'sandstone' },

  // Mid double doors: two leaves with a clear central gap and side frame pillars.
  { x: -3.7, z: 14, w: 2.7, d: 1.1, h: 4.8, kind: 'door' },
  { x: 3.7, z: 14, w: 2.7, d: 1.1, h: 4.8, kind: 'door' },
  { x: -7.3, z: 14, w: 2.0, d: 3.0, h: 5.5, kind: 'sandstone' },
  { x: 7.3, z: 14, w: 2.0, d: 3.0, h: 5.5, kind: 'sandstone' },

  // B tunnel lane: 9 m playable corridor between the two long walls.
  { x: -41.5, z: -5, w: 3.5, d: 35, h: 6.2, kind: 'tunnel' },
  { x: -28.5, z: -5, w: 3.5, d: 29, h: 6.0, kind: 'tunnel' },
  { x: -35, z: 14, w: 10, d: 3.5, h: 5.4, kind: 'sandstone' },
  { x: -21.5, z: 16.5, w: 5, d: 7, h: 5.5, kind: 'sandstone' },

  // A Long lane mirrors B but remains open-air and slightly wider at the site entrance.
  { x: 41.5, z: -5, w: 3.5, d: 35, h: 6.4, kind: 'sandstone' },
  { x: 28.5, z: -5, w: 3.5, d: 29, h: 5.7, kind: 'sandstone' },
  { x: 35, z: 14, w: 10, d: 3.5, h: 5.4, kind: 'sandstone' },
  { x: 21.5, z: 17.2, w: 5, d: 7, h: 5.5, kind: 'sandstone' },

  // CT courtyard and a central cover building that splits rotations toward A/B.
  { x: -17, z: 31.5, w: 18, d: 8, h: 6.5, kind: 'sandstone' },
  { x: 17, z: 31.5, w: 18, d: 8, h: 6.5, kind: 'sandstone' },
  { x: 0, z: 25.5, w: 8, d: 5, h: 4.8, kind: 'sandstone' },

  // B site cover. Positions are intentional firing/planting cover, not random clutter.
  { x: -31.5, z: 22.5, w: 2.8, d: 2.8, h: 2.8, kind: 'crate' },
  { x: -27.7, z: 24.2, w: 2.5, d: 2.5, h: 2.5, kind: 'crate' },
  { x: -23.2, z: 18.4, w: 3.2, d: 2.3, h: 2.2, kind: 'crate' },
  { x: -34.0, z: 18.4, w: 2.3, d: 4.5, h: 2.3, kind: 'crate' },

  // A site cover.
  { x: 30.8, z: 25.2, w: 3.0, d: 3.0, h: 3.0, kind: 'crate' },
  { x: 26.6, z: 28.0, w: 2.5, d: 4.0, h: 2.5, kind: 'crate' },
  { x: 22.8, z: 22.5, w: 3.2, d: 2.2, h: 2.2, kind: 'crate' },
  { x: 33.6, z: 20.2, w: 2.5, d: 4.8, h: 2.4, kind: 'crate' },

  // Mid cover, deliberately sparse so aim duels remain readable.
  { x: -5.6, z: 19.0, w: 3.0, d: 3.0, h: 2.2, kind: 'crate' },
  { x: 5.8, z: 19.0, w: 3.0, d: 3.0, h: 2.2, kind: 'crate' }
]);

export const DECOR = Object.freeze([
  { x: -44, z: 31, w: 3, d: 18, h: 9, kind: 'distant' },
  { x: 44, z: 31, w: 3, d: 18, h: 10, kind: 'distant' },
  { x: -44, z: -30, w: 3, d: 18, h: 8, kind: 'distant' },
  { x: 44, z: -30, w: 3, d: 18, h: 8, kind: 'distant' },
  { x: -24, z: 44, w: 15, d: 3, h: 9, kind: 'distant' },
  { x: 25, z: 44, w: 15, d: 3, h: 8, kind: 'distant' }
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
