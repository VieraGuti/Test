# VAST: Dead Zone — visual assets used in v0.5.11–v0.5.13

This file records the provenance of third-party visual assets integrated into the graphics/model passes. The gameplay/runtime code remains VAST project code. The assets listed below are used under CC0 / Public Domain terms as published by their original creators.

## Kenney — Nature Kit / survival props
- Original creator: Kenney
- Official pack: https://kenney.nl/assets/nature-kit
- License: CC0
- Runtime mirror used: https://github.com/rajsinghtech/spurfire
- Models used include trees, rocks, fences, gate, sign, barrel and signpost.

## Quaternius — Downtown City MegaKit
- Original creator: Quaternius
- Official pack: https://quaternius.com/packs/downtowncitymegakit.html
- License: CC0
- Runtime mirror used: https://github.com/anshaneja5/skyline-run
- Models used include small/medium buildings and urban AC props.

## Quaternius — weapon models
- Original creator: Quaternius
- Official gun pack reference: https://quaternius.com/packs/ultimategun.html
- License: CC0
- Runtime mirrors used:
  - https://github.com/turingfp/surfskinew @ be9b9f8e057b133740834b7553b991211edeed66
  - https://github.com/ndorony/test @ 806e3719296a2f6de32ddfbe5910ac3fe6e83847
- Models used include pistol, assault rifle, shotgun, bullpup-style weapon, sniper rifle and supply crate.

## Kenney — Car Kit
- Original creator: Kenney
- Official pack: https://kenney.nl/assets/car-kit
- License: CC0
- Runtime mirror used: https://github.com/Arslan12216775/kenney_car-kit @ 153591d606970058a4d0e44aeadf435c2d3f89ed
- Models used include sedan, SUV, van, truck, police car and ambulance.

## Runtime policy
The game keeps its original lightweight primitive geometry as a fallback while external GLB models load. If an external model cannot be fetched, gameplay and collisions continue using the fallback rather than blocking the game.
