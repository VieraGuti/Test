import type {WorkflowNode} from './types.ts';
export type NodeGuide={effect:string;needs:string[];example:string;warning:string};
export const NODE_GUIDES:Record<WorkflowNode['kind'],NodeGuide>={
  "event.started": {
    "effect": "Starts the event workflow. The next connected node runs immediately.",
    "needs": [
      "Exactly one start node per workflow."
    ],
    "example": "Start → Open registration → Save original positions",
    "warning": "This is a manual workflow trigger, not an automatic schedule."
  },
  "registration.open": {
    "effect": "Opens Discord registration, displays Join / Leave buttons and waits for the configured duration. The live bot updates the roster and closes the buttons when time runs out.",
    "needs": [
      "A configured Discord announcement channel and bot permissions.",
      "Players must link their identity and have a readable in-game position."
    ],
    "example": "Event started → Open registration → Save original positions",
    "warning": "The live event stops if nobody joins. It does not teleport players by itself."
  },
  "positions.save": {
    "effect": "Reads and records original positions for online participants before they are moved.",
    "needs": [
      "Registered participants and working RCON position reads."
    ],
    "example": "Open registration → Save original positions → Teleport to entry gates",
    "warning": "Saves coordinates, not inventories."
  },
  "players.teleport": {
    "effect": "Moves online, alive participants to their configured entry gates and tracks their return positions.",
    "needs": [
      "Save original positions on every preceding path.",
      "Valid arena and entry gates."
    ],
    "example": "Save positions → Teleport → Give event kit",
    "warning": "Verify the coordinates and terrain. Always include Return participants before ending."
  },
  "players.return": {
    "effect": "Returns eligible participants to their saved locations or configured exit gates.",
    "needs": [
      "Saved original positions and a working RCON connection."
    ],
    "example": "Announce results → Return participants → End & clean up",
    "warning": "Offline or dead players may require deferred recovery. This does not restore inventory."
  },
  "kits.give": {
    "effect": "Attempts to deliver the configured Rust server kit to each eligible participant and waits for confirmation.",
    "needs": [
      "A real kit already configured on the Rust server.",
      "Working kit delivery acknowledgements."
    ],
    "example": "Teleport → Give event kit → Preparation countdown",
    "warning": "The preset name is not a kit definition. It does not create weapons, armor or inventory items."
  },
  "zone.create": {
    "effect": "Creates an event-owned spherical zone centered on the configured arena with the selected PvP and radiation settings.",
    "needs": [
      "Valid arena coordinates and support for zone creation."
    ],
    "example": "Preparation countdown → Custom arena zone → Announce fight",
    "warning": "Zone creation changes the live world. End & clean up removes event-owned zones when deletion is verified."
  },
  "entity.spawn": {
    "effect": "Spawns the selected entities in a point, ring or mixed resource cluster using the configured coordinates.",
    "needs": [
      "Entity spawning enabled.",
      "Compatible entity names and safe terrain coordinates."
    ],
    "example": "Announce wave → Spawn entities → Wait / countdown",
    "warning": "Spawned entities may remain after the event. Automatic despawn is not verified."
  },
  "timer.wait": {
    "effect": "Waits for the configured number of seconds before continuing to the next node.",
    "needs": [
      "A connected next step."
    ],
    "example": "Send Discord message → Wait / countdown → Next wave",
    "warning": "Waiting does not freeze Rust gameplay. Use a separate Discord message for countdown notices."
  },
  "logic.remaining": {
    "effect": "Counts online, alive participants and follows Yes when the count is at or below the configured maximum; otherwise follows No.",
    "needs": [
      "Both Yes and No outputs connected.",
      "Reliable live player tracking."
    ],
    "example": "Wait 60s → Remaining players? → Yes: Announce results / No: Continue combat",
    "warning": "Checks only when execution reaches this node, not continuously."
  },
  "score.add": {
    "effect": "Adds the configured points to online, alive participants in the current event.",
    "needs": [
      "Participants in the running workflow."
    ],
    "example": "Survival phase → Add score → Announce results",
    "warning": "This is not automatic kill scoring or a persistent leaderboard."
  },
  "discord.send": {
    "effect": "Sends a message and the event embed to the configured Discord event channel.",
    "needs": [
      "A reachable channel and View Channel, Send Messages and Embed Links permissions."
    ],
    "example": "Send Discord message → Wait 10s → Activate arena",
    "warning": "Messages use supported event variables; mentions are suppressed."
  },
  "winner.announce": {
    "effect": "Announces the only online, alive survivor as winner, or reports that there is no sole winner.",
    "needs": [
      "A completed combat or survival phase and reliable player tracking."
    ],
    "example": "Remaining players? → Announce results → Return participants",
    "warning": "Does not calculate team scores or loot value, and does not distribute prizes."
  },
  "event.end": {
    "effect": "Completes the event and attempts to remove event-owned zones while keeping recovery records.",
    "needs": [
      "Return participants first on every teleport path."
    ],
    "example": "Announce results → Return participants → End & clean up",
    "warning": "Spawned entity cleanup and inventory restoration are not verified."
  }
};
export const PARAM_GUIDES:Record<string,{label:string;help:string;min?:number;max?:number}>={
  "seconds": {
    "label": "Duration",
    "help": "Seconds before continuing. 1–3600.",
    "min": 1,
    "max": 3600
  },
  "kit": {
    "label": "Server kit name",
    "help": "Exact name of a kit already configured in Rust."
  },
  "radius": {
    "label": "Radius",
    "help": "Distance from the arena center, in metres.",
    "min": 0,
    "max": 500
  },
  "radiation": {
    "label": "Radiation",
    "help": "Radiation intensity, 0–100.",
    "min": 0,
    "max": 100
  },
  "pvp": {
    "label": "Enable PvP",
    "help": "Requested PvP setting for the zone."
  },
  "entity": {
    "label": "Entity",
    "help": "Choose an entity from the supported registry."
  },
  "count": {
    "label": "Quantity",
    "help": "Number of entities, 1–500.",
    "min": 1,
    "max": 500
  },
  "layout": {
    "label": "Distribution",
    "help": "Point: same location. Ring: around center. Big node: mixed resource cluster."
  },
  "useArena": {
    "label": "Use arena center",
    "help": "Use the event arena instead of custom X/Y/Z."
  },
  "x": {
    "label": "X",
    "help": "Custom world coordinate.",
    "min": -10000,
    "max": 10000
  },
  "y": {
    "label": "Y",
    "help": "Custom height. Verify the terrain.",
    "min": -10000,
    "max": 10000
  },
  "z": {
    "label": "Z",
    "help": "Custom world coordinate.",
    "min": -10000,
    "max": 10000
  },
  "stone": {
    "label": "Stone nodes",
    "help": "Quantity in a mixed resource cluster.",
    "min": 0,
    "max": 500
  },
  "sulfur": {
    "label": "Sulfur nodes",
    "help": "Quantity in a mixed resource cluster.",
    "min": 0,
    "max": 500
  },
  "metal": {
    "label": "Metal nodes",
    "help": "Quantity in a mixed resource cluster.",
    "min": 0,
    "max": 500
  },
  "maximum": {
    "label": "Maximum survivors",
    "help": "Yes if online survivors are at or below this number.",
    "min": 0,
    "max": 1000
  },
  "points": {
    "label": "Points",
    "help": "Points added per eligible participant.",
    "min": 1,
    "max": 10000
  },
  "message": {
    "label": "Discord message",
    "help": "Variables: {event.name}, {event.players}, {event.max_players}, {event.winner} and more."
  }
};
