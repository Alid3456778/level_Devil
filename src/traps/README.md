Trap Extraction Notes

Current safe split:
- `src/traps/update.js` contains trap update logic and event-driven trap behavior.
- `src/traps/render.js` contains trap drawing/rendering logic.

Why this is still safe:
- The code was moved in execution order without changing trap logic.
- Globals and function names remain the same, so existing gameplay behavior is preserved.

Next safe step:
- Split `update.js` and `render.js` further by trap family only after browser playtesting.
- Recommended next files:
  - `spikes.js`
  - `holes.js`
  - `moving-walls.js`
  - `magnetic-spike.js`
  - `death-wall.js`
  - `platform-traps.js`
