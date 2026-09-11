# OUTPOST ZERO V5.2.0

Season 1 combat prototype. Stages 1–5 are playable; Season 1 is planned as 20 stages.

## V5.2.0 changes
- Combat shop + HP/stat HUD moved to the **top-right**.
- Minimap moved to the **bottom-left**.
- Fog cell size reduced from 28 world units to **6** so explored/remembered fog looks much finer.
- Three-state Fog remains: unexplored black / current vision clear / explored memory under dark fog.
- All living enemy bases now emit a **pulsing red signal on the minimap even through unexplored black fog**.
- Enemy density now escalates continuously over the 10-minute stage. Global hordes arrive more often and get larger over time, in addition to local base defenders and reinforcements.
- Enemy HP was lowered so common enemies die in roughly 1–2 baseline rifle hits; tougher enemies still take several hits.
- Enemy count has a stage-specific performance cap (180 → 285) to preserve mobile performance while still allowing large hordes.
- Economy / upgrade prices were rebalanced using nonlinear costs so early upgrades are reachable but specialization becomes progressively expensive.

## Core balance

### Character upgrades
| Upgrade | Start | Increase | Price formula |
|---|---:|---:|---|
| Attack | 15 | +5 | 170 + 55n + 22n² |
| Defense | 0 | +1 | 150 + 50n + 24n² |
| Speed | 190 | +10 | 125 + 42n + 18n² |
| Stim Pack | locked | permanent unlock | 850 Gold |

`n` is the number of purchases already made for that stat. Examples: Attack costs 170 → 247 → 368 → 533 → 742… Gold and purchased stats carry to the next cleared stage.

### Enemy baseline
| Enemy | HP before stage scaling | Karma | Role |
|---|---:|---:|---|
| Runner | 13 | 2 | fast melee, usually 1 rifle hit at Stage 1 |
| Raider | 22 | 3 | standard melee, usually 2 hits |
| Gunner | 24 | 5 | ranged fire |
| Spitter | 20 | 5 | slower projectile attack |
| Brute | 46 | 8 | heavy melee, several hits |

Stage scaling focuses more on **quantity and damage pressure** than HP inflation.

### Horde pressure by stage
| Stage | Max active enemies | Horde interval (early → late) | Horde size trend* |
|---|---:|---:|---:|
| 1 | 180 | 26s → 11s | about 8 → 22+ |
| 2 | 210 | 24s → 10s | about 10 → 26+ |
| 3 | 235 | 22s → 9s | about 12 → 30+ |
| 4 | 260 | 20s → 8s | about 14 → 35+ |
| 5 | 285 | 18s → 7.5s | about 16 → 40+ |

\* Actual group size changes with source-base tier and current active-enemy cap. Local base spawns are additional.

## Controls
- WASD / Arrow keys: Move
- U or double-tap: Combat shop
- E: Exchange Karma near the wreck / exchange station
- Q: Emergency heal (costs Gold)
- R by default: Stim Pack after permanent unlock
- ESC: Pause / save / quit menu

## Deploy
Unzip the update package and upload its **contents** to the root of the existing GitHub repository. Commit the changes. Render can keep the same Web Service / Blueprint and URL.
