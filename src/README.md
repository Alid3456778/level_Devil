Level Devil Frontend Refactor Plan

Current stage completed:
- The original inline runtime from `index.html` has been extracted into ordered script files under `src/`.
- `index.html` now loads a generated bundle: `src/runtime.bundle.js`.
- That bundle is built from the split source files so editing stays modular while browser load stays fast.
- This is a non-behavioral split intended to preserve the exact existing runtime.

Current extracted files:
- `src/audio.js`
- `src/multiplayer-core.js`
- `src/voice.js`
- `src/game-systems.js`
- `src/ui-tools.js`
- `src/auth-and-ui.js`
- `src/gameplay/start-and-loop.js`
- `src/gameplay/update-core.js`
- `src/gameplay/player-and-collisions.js`
- `src/gameplay/progression.js`
- `src/traps/update.js`
- `src/render/core.js`
- `src/traps/render.js`
- `src/render/entities.js`
- `src/input-and-boot.js`
- `src/runtime.bundle.js`

Bundle command:
- `npm run build:client`

Current state:
- `index.html` still contains markup and styles.
- The JavaScript is now split, but the logic is still globally scoped and should be modularized further in smaller passes.

Recommended staged split:

1. Core bootstrap
- `src/main.js`
- `src/config/constants.js`
- `src/core/state.js`
- `src/core/boot.js`
- `src/core/screen-manager.js`

2. Systems
- `src/systems/audio.js`
- `src/systems/input.js`
- `src/systems/mobile-controls.js`
- `src/systems/auth.js`
- `src/systems/feedback.js`
- `src/systems/leaderboard.js`
- `src/systems/multiplayer.js`
- `src/systems/physics.js`
- `src/systems/collision.js`
- `src/systems/render.js`
- `src/systems/level-loader.js`
- `src/systems/event-system.js`

3. Game entities
- `src/entities/player.js`
- `src/entities/remote-player.js`
- `src/entities/door.js`
- `src/entities/key.js`
- `src/entities/rope.js`

4. Trap files
- `src/traps/spikes.js`
- `src/traps/floor-hole.js`
- `src/traps/moving-hole.js`
- `src/traps/falling-spikes.js`
- `src/traps/magnetic-spike.js`
- `src/traps/moving-wall.js`
- `src/traps/death-wall.js`
- `src/traps/fake-loading-screen.js`
- `src/traps/shrinking-gap-platform.js`
- `src/traps/moving-platform.js`
- `src/traps/disappearing-ground.js`
- `src/traps/fake-platform.js`

5. UI
- `src/ui/name-screen.js`
- `src/ui/mode-screen.js`
- `src/ui/lobby-screen.js`
- `src/ui/overlays.js`
- `src/ui/admin-tools.js`

Safe migration order:
- First move auth, feedback, leaderboard, and mode screen helpers.
- Then move audio/input/mobile controls.
- Then extract level loading and event system.
- Finally split traps one by one and verify each level after each extraction.

Important rule:
- Do not refactor all trap logic at once.
- Move one trap family, test the levels that use it, then continue.
