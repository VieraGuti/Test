export const WEAPONS = Object.freeze({
  sidearm: { id: 'sidearm', name: 'PX-9', slot: 1, price: 0, damage: 28, headMult: 3.2, rpm: 360, mag: 15, reserve: 60, reloadMs: 1450, spread: 0.008, range: 55, killReward: 300 },
  smg: { id: 'smg', name: 'Viper-9', slot: 2, price: 1250, damage: 22, headMult: 2.4, rpm: 780, mag: 30, reserve: 90, reloadMs: 1850, spread: 0.016, range: 42, killReward: 600 },
  rifle: { id: 'rifle', name: 'VXR-47', slot: 2, price: 2700, damage: 36, headMult: 3.0, rpm: 600, mag: 30, reserve: 90, reloadMs: 2200, spread: 0.010, range: 75, killReward: 300 },
  sniper: { id: 'sniper', name: 'Longshot .338', slot: 2, price: 4750, damage: 108, headMult: 1.6, rpm: 45, mag: 5, reserve: 20, reloadMs: 2900, spread: 0.001, range: 120, killReward: 100 }
});
export const BUY_ITEMS = Object.freeze({ ...WEAPONS, armor: { id: 'armor', name: 'Kevlar', price: 650, armor: 100 } });
export function weaponById(id) { return WEAPONS[id] ?? WEAPONS.sidearm; }
