// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  AUDIO SYSTEM
//  Files live in: assets/music/
//  Expects: bg_game.mp3, bg_menu.mp3, sfx_death.mp3,
//           sfx_win.mp3, sfx_key.mp3, sfx_door.mp3,
//           sfx_jump.mp3, sfx_fall.mp3, sfx_spike.mp3
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const AUDIO = {
  _ctx:    null,
  _bgNode: null,
  _bgGain: null,
  _sfxGain: null,
  _muted:  false,
  _bgFile: null,

  // â”€â”€ Init AudioContext on first user gesture â”€â”€
  _ensureCtx() {
    if (this._ctx) return;
    try {
      this._ctx    = new (window.AudioContext || window.webkitAudioContext)();
      this._bgGain = this._ctx.createGain();
      this._bgGain.gain.value = 0.35;
      this._bgGain.connect(this._ctx.destination);
      this._sfxGain = this._ctx.createGain();
      this._sfxGain.gain.value = 0.7;
      this._sfxGain.connect(this._ctx.destination);
    } catch(e) { console.warn('[Audio] init failed:', e); }
  },

  // â”€â”€ Load a file and decode into AudioBuffer â”€â”€
  async _load(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      const buf = await res.arrayBuffer();
      return await this._ctx.decodeAudioData(buf);
    } catch(e) {
      console.warn('[Audio] load failed:', url, e.message);
      return null;
    }
  },

  // â”€â”€ Play background music (loops) â”€â”€
  async playBg(file) {
    this._ensureCtx();
    if (!this._ctx) return;
    if (this._bgFile === file) return; // already playing
    this.stopBg();
    this._bgFile = file;
    const buf = await this._load('assets/music/' + file);
    if (!buf || this._bgFile !== file) return; // superseded
    this._bgNode = this._ctx.createBufferSource();
    this._bgNode.buffer = buf;
    this._bgNode.loop   = true;
    this._bgNode.connect(this._bgGain);
    if (!this._muted) this._bgNode.start(0);
  },

  // â”€â”€ Stop background music â”€â”€
  stopBg() {
    if (this._bgNode) {
      try { this._bgNode.stop(); } catch(e) {}
      this._bgNode = null;
    }
    this._bgFile = null;
  },

  // â”€â”€ Play a one-shot sound effect â”€â”€
  async playSfx(file) {
    this._ensureCtx();
    if (!this._ctx || this._muted) return;
    const buf = await this._load('assets/music/' + file);
    if (!buf) return;
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this._sfxGain);
    src.start(0);
  },

  // â”€â”€ Toggle global mute â”€â”€
  toggleMute() {
    this._muted = !this._muted;
    if (this._bgGain)  this._bgGain.gain.value  = this._muted ? 0 : 0.35;
    if (this._sfxGain) this._sfxGain.gain.value  = this._muted ? 0 : 0.7;
    return this._muted;
  },

  setVolume(bgVol, sfxVol) {
    this._ensureCtx();
    if (this._bgGain  && bgVol  !== undefined) this._bgGain.gain.value  = bgVol;
    if (this._sfxGain && sfxVol !== undefined) this._sfxGain.gain.value = sfxVol;
  },
};

// Unlock AudioContext on first touch/click (required on iOS)
['touchstart','mousedown','keydown'].forEach(ev => {
  document.addEventListener(ev, function _unlock() {
    AUDIO._ensureCtx();
    if (AUDIO._ctx && AUDIO._ctx.state === 'suspended') {
      AUDIO._ctx.resume().catch(() => {});
    }
    document.removeEventListener(ev, _unlock);
  }, { once: true });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
