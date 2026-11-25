import type {ActionKind, WorkflowNode} from './types.ts';
export const ACTIONS: {kind:ActionKind;params:WorkflowNode['params']}[] = [
{kind:'event.started',params:{}},
{kind:'registration.open',params:{seconds:30}},
{kind:'positions.save',params:{}},
{kind:'players.teleport',params:{}},
{kind:'kits.give',params:{kit:'survivor'}},
{kind:'zone.create',params:{radius:65,radiation:0,pvp:false}},
{kind:'entity.spawn',params:{entity:'wolf',count:6,layout:'ring',useArena:true,x:0,y:20,z:0,radius:40,stone:0,sulfur:0,metal:0}},
{kind:'timer.wait',params:{seconds:90}},
{kind:'logic.remaining',params:{maximum:1}},
{kind:'score.add',params:{points:10}},
{kind:'discord.send',params:{message:'{event.name} is underway.'}},
{kind:'winner.announce',params:{}},
{kind:'players.return',params:{}},
{kind:'event.end',params:{}}
];
export const ENTITIES = ['wolf','bear','boar','chicken','stag','simpleshark','minicopter.entity','scraptransporthelicopter','2module_car_spawned.entity','motorbike','motorbike_sidecar','rowboat','rhib','testridablehorse','sulfur-ore','stone-ore','metal-ore','sulfur-collectable','stone-collectable','metal-collectable','crate_basic','crate_elite','crate_ammunition','crate_medical'];