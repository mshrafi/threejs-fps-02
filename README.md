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
  3s), then defend it until it blows — or eliminate the enemy team. First to
  5 rounds takes the match.
- **Money:** start with $800; kills pay $300, a round win $3,000, a loss
  $1,500. Spend it in the buy menu (`B` during the buy phase).
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
| R | Reload |
| B, then 1–5 | Buy menu / buy weapon or grenade |
| G | Throw grenade |
| E (hold) | Plant the charge at a site |
| M | Mute |

## Screenshots

Deterministic captures: `?shot=start|play|end&seed=N`. The cover is a live
combat frame: muzzle flash, lightning, rain and neon.

## Competition

Entry for the [make.fun bounty: best three.js tactical FPS](https://make.fun/bounty/threejs-fps-02).
Owner: mshrafi · Referral code: `7qb8d53t` · Built with [make.fun](https://make.fun).
