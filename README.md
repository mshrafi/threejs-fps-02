# Monsoon Strike — a three.js tactical FPS

[![make.fun](https://make.fun/badge.svg)](https://make.fun/bounty/threejs-fps-02)

A round-based tactical shooter in the style Counter-Strike made famous, built
with three.js and no build step. Barsha Guard vs Neon Reavers, 5v5 with bots,
on an original industrial harbour map with two objective sites, three lanes, an
economy, a buy menu, and a charge to plant and defuse.

## The theme

Monsoon Strike is set on a rainy Dhaka night street in the middle of a
monsoon storm: wet reflective asphalt and puddles that catch the neon, shop
signs for fictional places (Chai Ghar, Megh Mobile, Neon Biryani, Jol Cafe),
rickshaws parked as alley cover, street lamps, and a night sky that flashes
with lightning. The map layout — A-long, mid market yard, B-tunnels, two
sites — is tactical; the look is a night city in the rain, not a grey box.

## The twist

Lightning strikes mid-round and cuts the street lights for a few seconds: a
blackout where muzzle flashes and tracers become the main light and bots
shoot worse in the dark. The rain also changes movement — the streets are
slick, so stopping takes longer and slides carry further. Bots have distinct
jobs: flankers take the long lane around the far side (and the kill feed
calls it out), and one bot falls back to heal and regroup when hurt instead
of fighting to the death.

## How to run

```sh
node serve.ts
# then open http://localhost:8080
```

Desktop Chrome, no network needed — three.js is vendored under `game/vendor/`.

## How to play

- **Objective:** plant the charge at Site A or Site B (hold `E` at a site for
  3s), then fall back — it blows in 40s and the blast kills anyone standing
  on the site. Or eliminate the enemy team. First to 5 rounds takes the match.
- **Money:** start with $1,500 on the P9 sidearm; kills pay $300, a round win
  $3,000, a loss $1,500. Spend it in the buy menu (`B` during the buy phase).
  Round 1 is a real choice — the Jol-9 SMG or grenades now, the Megh-7
  after a win — and the menu marks the owned gun OWNED and dims whatever
  you cannot afford.
- **Weapons:** Megh-7 Carbine ($2,700, auto), Jol-9 SMG ($1,500), Bijli-50
  marksman ($4,500), P9 sidearm (free), and the Spark grenade ($300, throw
  with `G`).
- **Movement:** `WASD` move, `Shift` walk/aim, `Ctrl`/`C` crouch, `Space`
  jump. Stopping to aim pays: spread grows while moving and firing, headshots
  deal 3× damage, and the wet streets make you slide.

## Controls

| Key | Action |
| --- | --- |
| Mouse | Look |
| Click | Fire |
| Right mouse | Aim down sights (tighter spread, narrower FOV, raised gun) |
| R | Reload |
| Q / scroll wheel | Swap between the bought gun and the P9 sidearm (permanent secondary) |
| B, then 1–5 | Buy menu / buy weapon or grenade |
| G | Throw grenade |
| E (hold) | Plant the charge at a site |
| M | Mute |

## v3 changes

- **No more spawn melt:** at most two reavers may focus the player, their
  damage against the player scales down with the number engaging, and the
  last living sentinel gets a 3 s grace with a callout while reavers hold —
  an idle player now survives well past 25 s of live play instead of dying
  in 3.5 s.
- **Defuse actually happens:** a planted charge outranks gunshot curiosity,
  the closest reaver breaks off a firefight to rotate to the site (all of
  them 5 s after planting), and the charge timer is 40 s so the long route
  into Site A is survivable. The plant banner now says to fall back, and
  the HUD warns when the blast is under 10 s away and you are close.
- **Real round-1 economy:** the player starts on the P9 with $1,500, so the
  Jol-9 is the round-1 buy and the Megh-7 is the round-2 aspiration. The buy
  menu marks the owned gun OWNED and dims unaffordable rows outright.
- **Sentinels hold mid:** two defenders now hold the mid nodes instead of
  every defender pushing a site into reaver crossfire, and reaver-vs-bot
  accuracy is shaved, so bot fights are winnable without the player.
- **Cleaner frames:** tracers whose both ends are off-screen are not drawn
  (they read as scratches), the play capture sets the muzzle flash after
  the settle so it is actually in the frame, and the end capture is
  reframed from the pad's south-east corner with the mates facing the
  camera, the view model hidden, the kill feed cleared and re-added, and a
  crate and drum at the pad edge for foreground depth.
- **Cover is real:** a hurt bot now actually falls back along a retreat
  path instead of standing in the open at low health.

## v2 changes

- **Bots actually play the map:** sight range cut from 42 m to 26 m and bots
  must leave their spawn third before they can engage, so routes, flanks and
  site holds run instead of every bot fighting from spawn. The charge carrier
  pushes its site instead of chasing distant gunfire. Bot accuracy and damage
  fall off at long range, so the opening crossfire no longer melts the player.
- **Waypoint graph probe-verified:** every graph edge was checked against the
  map's colliders with the bots' own 0.34 m probe; edges that crossed walls
  (and wedged bots, since the mover has no push-out) were cut or rerouted
  through two new gap waypoints, and the obstacles that clipped the rest were
  moved. All 40 edges are now clean and the graph is fully connected.
- **Gunplay:** recoil now decays back over ~0.3 s instead of climbing the
  pitch permanently; right-mouse aim-down-sights halves the field of view and
  tightens spread; the P9 is a permanent secondary (Q / scroll) with
  per-weapon ammo, and re-buying the equipped gun is a no-op instead of
  charging full price. The player's own gun finally makes sound.
- **Round flow:** the player can move during the buy phase, and the buy menu
  closes itself when the round goes live (B/Esc close it any time). Death
  now shows an elimination banner and kill-feed line, exits pointer lock and
  opens the down overlay immediately.
- **Look:** bots are slimmer with a dark visor and no ground ring; the view
  model is slimmer with a grip, magazine and second tone; rain renders as
  streaks instead of pale squares; a cool fill light keeps the mid
  containers' north faces out of near-black.
- **Code:** dead code removed (unused bot reset, unread round-result fields);
  spawn coordinates now live in one place (`SPAWNS`); the defuse beep, lamp
  and fill lights are actually driven; per-shot and per-scan allocations were
  hoisted to reused scratch (ray targets, enemy lists, BFS scratch, look
  vector); the plant label moved out of its clipped bar, and the page has an
  inline SVG favicon instead of a 404.

## Screenshots

Deterministic captures: `?shot=start|play|end&seed=N`. The cover is a live
combat frame: muzzle flash, lightning, rain and neon.

## Competition

Entry for the [make.fun bounty: best three.js tactical FPS](https://make.fun/bounty/threejs-fps-02).
Owner: mshrafi · Referral code: `7qb8d53t` · Built with [make.fun](https://make.fun).
