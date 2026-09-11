# OUTPOST ZERO V5.1.0

Season 1 combat-focused prototype. First five of twenty planned stages are implemented.

## V5.1 changes
- Fog of War rebuilt without a large circular spotlight: unexplored = black, current cells = clear, previously explored = fixed terrain remembered under dark gray fog
- Minimap reflects the same three fog states
- Stim Pack: permanent unlock, costs exactly 10 HP per use, no cooldown, 10 seconds of x2 combat performance; disabled at HP 10 or below
- One unified combat shop only: Attack +5, Defense +1, Speed +10, Stim permanent unlock
- HUD shows numeric Attack / Defense / Speed
- Stage-clear carries Attack / Defense / Speed / Gold into the next stage until the player explicitly abandons the season run
- Season 1 has no recruit/companion purchases and no home base
- Starting safe point is a crashed spacecraft wreck; it restores HP and exchanges Karma
- Stage 3+ can add external Karma exchange points
- Enemy contact alone causes no damage; melee attacks and ranged projectiles are explicit attacks
- Added varied enemy attacks: melee, heavy melee, gunner shots, and spit projectiles
- Player/enemies/buildings/terrain are solid and cannot simply pass through one another
- Enemy HP reduced while enemy counts and reinforcements increased for more frequent kills and stronger pressure

## Deploy
Upload the project contents to the root of the existing GitHub repository and commit. Render can continue using the existing Blueprint / Web Service.
