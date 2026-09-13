# VAST: Dead Zone

Modern mobile/browser revival of the survival-FPS ideas explored in **FreeSurvivalZombieKit** by Leandro Vieira.

## Current build

This branch is a new WebGL/Three.js adaptation designed to run directly in Safari/Chrome on phones, especially landscape mobile play.

Implemented in the first playable build:

- First-person 3D movement and touch camera.
- Left analog joystick + right-side look zone.
- FIRE, AIM, RELOAD, USE, RUN and JUMP mobile controls.
- Pistol, assault rifle and shotgun with magazines, reserve ammo, recoil and headshots.
- Zombie AI with roaming, hearing, chase and melee attack states.
- Loot for weapons, ammunition, water, food and medkits.
- Health, hunger, thirst and stamina survival systems.
- Day/night cycle, fog, street lighting and changing threat level.
- Procedural abandoned-zone environment with gas station, warehouse, clinic, motel, roads, wrecks, containers, fences and cover.
- Mobile HUD, objectives, settings, graphics presets and local saved preferences.
- Desktop controls are kept for development/testing (WASD, mouse, R, E, Space, Shift, 1-3).

## Source / permission

Original reference project: `leandrovieiraa/FreeSurvivalZombieKit`  
Pinned source inspected: `622965fe995be252303598d38aafd83c3a07aef9`

On 2026-09-13 Ángel reported that the original author explicitly gave permission to go ahead with the project and modify/use it. This repository keeps that provenance visible rather than presenting the historical project as original VAST work.

The current browser build is largely a fresh implementation because the historical project targets Unity 2018.2 and its published branch does not contain a complete mobile/WebGL game or the zombie AI required for this version.

See `SOURCE_PERMISSION.md` for the provenance note.
