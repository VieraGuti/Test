import {ACTIONS} from './catalog.ts';
import type {WorkflowNode} from './types.ts';
export type NodePreset={id:string;category:string;kind:WorkflowNode['kind'];label:string;description:string;params:WorkflowNode['params']};
export const NODE_PRESETS:NodePreset[]=[
  {
    "id": "trigger",
    "category": "Triggers",
    "kind": "event.started",
    "label": "Event started",
    "description": "Start a workflow manually or from Discord.",
    "params": {}
  },
  {
    "id": "registration",
    "category": "Registration",
    "kind": "registration.open",
    "label": "Open registration",
    "description": "Join / Leave buttons, roster and countdown.",
    "params": {
      "seconds": 120
    }
  },
  {
    "id": "quick-registration",
    "category": "Registration",
    "kind": "registration.open",
    "label": "Quick registration",
    "description": "30 seconds for small test events.",
    "params": {
      "seconds": 30
    }
  },
  {
    "id": "tournament-registration",
    "category": "Registration",
    "kind": "registration.open",
    "label": "Tournament registration",
    "description": "Allow 5 minutes for players to join.",
    "params": {
      "seconds": 300
    }
  },
  {
    "id": "positions",
    "category": "Players",
    "kind": "positions.save",
    "label": "Save original positions",
    "description": "Record verified coordinates before moving players.",
    "params": {}
  },
  {
    "id": "teleport",
    "category": "Players",
    "kind": "players.teleport",
    "label": "Teleport to entry gates",
    "description": "Use configured individual or team gates.",
    "params": {}
  },
  {
    "id": "return",
    "category": "Players",
    "kind": "players.return",
    "label": "Return participants",
    "description": "Restore eligible players to saved coordinates.",
    "params": {}
  },
  {
    "id": "kit",
    "category": "Equipment",
    "kind": "kits.give",
    "label": "Give event kit",
    "description": "Select a kit name configured on the Rust server.",
    "params": {
      "kit": "survivor"
    }
  },
  {
    "id": "pvp-kit",
    "category": "Equipment",
    "kind": "kits.give",
    "label": "PvP kit",
    "description": "Starter preset: edit to match an existing server kit.",
    "params": {
      "kit": "arena"
    }
  },
  {
    "id": "medic-kit",
    "category": "Equipment",
    "kind": "kits.give",
    "label": "Medical kit",
    "description": "Starter preset: edit to match an existing server kit.",
    "params": {
      "kit": "medic"
    }
  },
  {
    "id": "farm-kit",
    "category": "Equipment",
    "kind": "kits.give",
    "label": "Farming kit",
    "description": "Starter preset: edit to match an existing server kit.",
    "params": {
      "kit": "farmer"
    }
  },
  {
    "id": "team-kit",
    "category": "Equipment",
    "kind": "kits.give",
    "label": "Team kit",
    "description": "Starter preset for both teams.",
    "params": {
      "kit": "team"
    }
  },
  {
    "id": "zone",
    "category": "World",
    "kind": "zone.create",
    "label": "Custom arena zone",
    "description": "Configure radius, PvP and radiation.",
    "params": {
      "radius": 65,
      "radiation": 0,
      "pvp": false
    }
  },
  {
    "id": "pvp-zone",
    "category": "World",
    "kind": "zone.create",
    "label": "PvP arena",
    "description": "100 m zone with PvP enabled.",
    "params": {
      "radius": 100,
      "radiation": 0,
      "pvp": true
    }
  },
  {
    "id": "radiation",
    "category": "World",
    "kind": "zone.create",
    "label": "Radiation zone",
    "description": "65 m zone with radiation intensity 20.",
    "params": {
      "radius": 65,
      "radiation": 20,
      "pvp": false
    }
  },
  {
    "id": "farm-zone",
    "category": "World",
    "kind": "zone.create",
    "label": "Safe farming zone",
    "description": "80 m non-PvP arena.",
    "params": {
      "radius": 80,
      "radiation": 0,
      "pvp": false
    }
  },
  {
    "id": "spawn",
    "category": "Spawning",
    "kind": "entity.spawn",
    "label": "Spawn entities",
    "description": "Select an entity and distribution.",
    "params": {}
  },
  {
    "id": "wolves",
    "category": "Spawning",
    "kind": "entity.spawn",
    "label": "Wolf wave",
    "description": "Six wolves in a ring.",
    "params": {
      "entity": "wolf",
      "count": 6,
      "radius": 40
    }
  },
  {
    "id": "bears",
    "category": "Spawning",
    "kind": "entity.spawn",
    "label": "Bear wave",
    "description": "Two bears in a ring.",
    "params": {
      "entity": "bear",
      "count": 2,
      "radius": 48
    }
  },
  {
    "id": "sulfur",
    "category": "Spawning",
    "kind": "entity.spawn",
    "label": "Sulfur node ring",
    "description": "Ten sulfur nodes on the arena plane.",
    "params": {
      "entity": "sulfur-ore",
      "count": 10,
      "radius": 20
    }
  },
  {
    "id": "metal",
    "category": "Spawning",
    "kind": "entity.spawn",
    "label": "Metal node ring",
    "description": "Five metal nodes.",
    "params": {
      "entity": "metal-ore",
      "count": 5,
      "radius": 30
    }
  },
  {
    "id": "stone",
    "category": "Spawning",
    "kind": "entity.spawn",
    "label": "Stone node ring",
    "description": "Five stone nodes.",
    "params": {
      "entity": "stone-ore",
      "count": 5,
      "radius": 40
    }
  },
  {
    "id": "big-node",
    "category": "Spawning",
    "kind": "entity.spawn",
    "label": "Big node cluster",
    "description": "Mixed resource cluster; verify terrain and height.",
    "params": {
      "entity": "sulfur-ore",
      "layout": "big-node",
      "count": 20,
      "sulfur": 10,
      "stone": 5,
      "metal": 5,
      "radius": 12
    }
  },
  {
    "id": "basic-loot",
    "category": "Spawning",
    "kind": "entity.spawn",
    "label": "Basic loot drop",
    "description": "Twelve basic crates.",
    "params": {
      "entity": "crate_basic",
      "count": 12,
      "radius": 28
    }
  },
  {
    "id": "elite-loot",
    "category": "Spawning",
    "kind": "entity.spawn",
    "label": "Elite loot drop",
    "description": "Four elite crates.",
    "params": {
      "entity": "crate_elite",
      "count": 4,
      "radius": 12
    }
  },
  {
    "id": "medical-loot",
    "category": "Spawning",
    "kind": "entity.spawn",
    "label": "Medical loot drop",
    "description": "Four medical crates.",
    "params": {
      "entity": "crate_medical",
      "count": 4,
      "radius": 42
    }
  },
  {
    "id": "vehicle",
    "category": "Spawning",
    "kind": "entity.spawn",
    "label": "Vehicle spawn",
    "description": "Select a compatible vehicle; verify terrain.",
    "params": {
      "entity": "rowboat",
      "count": 1,
      "layout": "point",
      "radius": 0
    }
  },
  {
    "id": "wait",
    "category": "Timing",
    "kind": "timer.wait",
    "label": "Wait / countdown",
    "description": "Pause a workflow for a configurable duration.",
    "params": {
      "seconds": 90
    }
  },
  {
    "id": "prep",
    "category": "Timing",
    "kind": "timer.wait",
    "label": "Preparation countdown",
    "description": "10 seconds for players to get ready.",
    "params": {
      "seconds": 10
    }
  },
  {
    "id": "minute",
    "category": "Timing",
    "kind": "timer.wait",
    "label": "One-minute phase",
    "description": "60 seconds of gameplay.",
    "params": {
      "seconds": 60
    }
  },
  {
    "id": "combat",
    "category": "Timing",
    "kind": "timer.wait",
    "label": "Combat phase",
    "description": "5 minutes maximum.",
    "params": {
      "seconds": 300
    }
  },
  {
    "id": "remaining",
    "category": "Conditions",
    "kind": "logic.remaining",
    "label": "Remaining players",
    "description": "Yes / No branch based on online survivors.",
    "params": {
      "maximum": 1
    }
  },
  {
    "id": "none-left",
    "category": "Conditions",
    "kind": "logic.remaining",
    "label": "No survivors?",
    "description": "Branch when there are no online survivors.",
    "params": {
      "maximum": 0
    }
  },
  {
    "id": "score",
    "category": "Scoring",
    "kind": "score.add",
    "label": "Add score",
    "description": "Award configured points to alive online participants.",
    "params": {
      "points": 10
    }
  },
  {
    "id": "message",
    "category": "Discord",
    "kind": "discord.send",
    "label": "Send Discord message",
    "description": "Message with event variables and embed.",
    "params": {
      "message": "{event.name} is underway."
    }
  },
  {
    "id": "closed",
    "category": "Discord",
    "kind": "discord.send",
    "label": "Announce registration closed",
    "description": "Tell participants registration has ended.",
    "params": {
      "message": "🔒 Registration closed: {event.players}/{event.max_players}."
    }
  },
  {
    "id": "fight",
    "category": "Discord",
    "kind": "discord.send",
    "label": "Announce fight",
    "description": "Tell players the match is underway.",
    "params": {
      "message": "⚔️ FIGHT! {event.name} has started."
    }
  },
  {
    "id": "wave",
    "category": "Discord",
    "kind": "discord.send",
    "label": "Announce next wave",
    "description": "Send a customizable wave warning.",
    "params": {
      "message": "⚠️ Next wave is coming. Get ready!"
    }
  },
  {
    "id": "final-ten",
    "category": "Discord",
    "kind": "discord.send",
    "label": "Final countdown notice",
    "description": "Warn players about the last ten seconds. Pair with a 10-second wait.",
    "params": {
      "message": "⏳ 10 seconds remaining!"
    }
  },
  {
    "id": "winner",
    "category": "Results",
    "kind": "winner.announce",
    "label": "Announce results",
    "description": "Individual survivor result; not team or loot scoring.",
    "params": {}
  },
  {
    "id": "end",
    "category": "Cleanup",
    "kind": "event.end",
    "label": "End & clean up",
    "description": "Delete event-owned zones and retain return records; entity despawn not verified.",
    "params": {}
  }
,...[{"id":"game-registration","category":"Registration","kind":"registration.open","label":"In-game registration","description":"Join and leave using SERVER Quick Chat.","params":{"seconds":120,"mode":"game"}},{"id":"hybrid-registration","category":"Registration","kind":"registration.open","label":"Discord + in-game registration","description":"Accept both entry methods during the registration period.","params":{"seconds":120,"mode":"both"}},{"id":"boars","category":"Spawning","kind":"entity.spawn","label":"Boar wave","description":"Spawn this entity preset; verify server support and terrain.","params":{"entity":"boar","count":8,"radius":45,"layout":"ring"}},{"id":"chickens","category":"Spawning","kind":"entity.spawn","label":"Chicken hunt","description":"Spawn this entity preset; verify server support and terrain.","params":{"entity":"chicken","count":12,"radius":45,"layout":"ring"}},{"id":"stags","category":"Spawning","kind":"entity.spawn","label":"Stag hunt","description":"Spawn this entity preset; verify server support and terrain.","params":{"entity":"stag","count":8,"radius":60,"layout":"ring"}},{"id":"sharks","category":"Spawning","kind":"entity.spawn","label":"Shark spawn","description":"Spawn this entity preset; verify server support and terrain.","params":{"entity":"simpleshark","count":2,"radius":30,"layout":"ring"}},{"id":"minicopter","category":"Spawning","kind":"entity.spawn","label":"Minicopter spawn","description":"Spawn this entity preset; verify server support and terrain.","params":{"entity":"minicopter.entity","count":1,"radius":0,"layout":"point"}},{"id":"scrap-heli","category":"Spawning","kind":"entity.spawn","label":"Scrap transport helicopter","description":"Spawn this entity preset; verify server support and terrain.","params":{"entity":"scraptransporthelicopter","count":1,"radius":0,"layout":"point"}},{"id":"cars","category":"Spawning","kind":"entity.spawn","label":"Car spawn","description":"Spawn this entity preset; verify server support and terrain.","params":{"entity":"2module_car_spawned.entity","count":4,"radius":55,"layout":"ring"}},{"id":"motorbikes","category":"Spawning","kind":"entity.spawn","label":"Motorbike lineup","description":"Spawn this entity preset; verify server support and terrain.","params":{"entity":"motorbike","count":8,"radius":60,"layout":"ring"}},{"id":"sidecars","category":"Spawning","kind":"entity.spawn","label":"Sidecar lineup","description":"Spawn this entity preset; verify server support and terrain.","params":{"entity":"motorbike_sidecar","count":4,"radius":60,"layout":"ring"}},{"id":"rhib","category":"Spawning","kind":"entity.spawn","label":"RHIB spawn","description":"Spawn this entity preset; verify server support and terrain.","params":{"entity":"rhib","count":1,"radius":0,"layout":"point"}},{"id":"horse","category":"Spawning","kind":"entity.spawn","label":"Horse lineup","description":"Spawn this entity preset; verify server support and terrain.","params":{"entity":"testridablehorse","count":8,"radius":60,"layout":"ring"}},{"id":"ammo","category":"Spawning","kind":"entity.spawn","label":"Ammunition crates","description":"Spawn this entity preset; verify server support and terrain.","params":{"entity":"crate_ammunition","count":6,"radius":45,"layout":"ring"}},{"id":"stone-pickup","category":"Spawning","kind":"entity.spawn","label":"Stone collectibles","description":"Spawn this entity preset; verify server support and terrain.","params":{"entity":"stone-collectable","count":12,"radius":45,"layout":"ring"}},{"id":"metal-pickup","category":"Spawning","kind":"entity.spawn","label":"Metal collectibles","description":"Spawn this entity preset; verify server support and terrain.","params":{"entity":"metal-collectable","count":12,"radius":45,"layout":"ring"}},{"id":"sulfur-pickup","category":"Spawning","kind":"entity.spawn","label":"Sulfur collectibles","description":"Spawn this entity preset; verify server support and terrain.","params":{"entity":"sulfur-collectable","count":12,"radius":45,"layout":"ring"}}]
];
export function presetNode(id:string,nodeId:string,position:WorkflowNode['position']):WorkflowNode {const p=NODE_PRESETS.find(p=>p.id===id);if(!p)throw new Error('Unknown node preset');const action=ACTIONS.find(a=>a.kind===p.kind);if(!action)throw new Error('Unsupported action');return {id:nodeId,kind:p.kind,label:p.label,position,params:{...action.params,...p.params}};}
export function searchNodePresets(q:string){const terms=q.trim().toLowerCase().split(/\s+/).filter(Boolean);return NODE_PRESETS.filter(p=>terms.every(t=>[p.label,p.category,p.description,p.kind].join(' ').toLowerCase().includes(t)));}
