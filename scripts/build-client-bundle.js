const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'src', 'runtime.bundle.js');

const inputFiles = [
  'src/audio.js',
  'src/multiplayer-core.js',
  'src/voice.js',
  'src/game-systems.js',
  'src/ui-tools.js',
  'src/auth-and-ui.js',
  'src/gameplay/start-and-loop.js',
  'src/gameplay/update-core.js',
  'src/traps/update.js',
  'src/gameplay/player-and-collisions.js',
  'src/gameplay/progression.js',
  'src/render/core.js',
  'src/traps/render.js',
  'src/render/entities.js',
  'src/input-and-boot.js',
];

const parts = inputFiles.map((rel) => {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(`Missing source file: ${rel}`);
  }
  const text = fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
  return `/* ===== ${rel} ===== */\n${text.trimEnd()}\n`;
});

fs.writeFileSync(output, parts.join('\n'), 'utf8');
console.log(`Built ${path.relative(root, output)} from ${inputFiles.length} files.`);
