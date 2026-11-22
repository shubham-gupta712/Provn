/* Provn 3D player — KayKit characters (CC0, Kay Lousberg) rendered with three.js.
   Any element with class "av3d" gets a live 3D player. data-mode: you | path | cele.
   Each theme has its own lighting, hand prop and animation set. */
import * as THREE from 'three';
import { GLTFLoader } from './lib/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from './lib/addons/utils/SkeletonUtils.js';

export const CHARS = {
  Knight: 'Knight', Barbarian: 'Barbarian', Mage: 'Mage', Ranger: 'Ranger', Rogue: 'Rogue', Rogue_Hooded: 'Hooded rogue',
  Skeleton_Warrior: 'Skeleton warrior', Skeleton_Mage: 'Skeleton mage', Skeleton_Rogue: 'Skeleton rogue', Skeleton_Minion: 'Skeleton minion'
};
const SETS = {
  dusk:      { idle: 'Idle_A', walk: 'Mx_Walk', tap: 'Mx_Walk',  cheer: 'Jump_Full_Short' },
  nightfall: { idle: 'Idle_B', walk: 'Mx_Walk', tap: 'Use_Item', cheer: 'Spawn_Air' },
  volt:      { idle: 'Mx_Run', walk: 'Mx_Run',  tap: 'Throw',    cheer: 'Jump_Full_Long' }
};
const theme = () => document.documentElement.dataset.theme || 'dusk';
const getChar = () => { try { const v = JSON.parse(localStorage.getItem('provn_char')); return CHARS[v] ? v : 'Knight'; } catch (e) { return 'Knight'; } };

const loader = new GLTFLoader();
const charCache = {};
let clipsP = null;
const loadChar = n => charCache[n] || (charCache[n] = loader.loadAsync(`assets/chars/${n}.glb`));
/* KayKit's own clips plus Mixamo moves converted onto the KayKit skeleton (assets/anims/mixamo.json: Mx_Walk, Mx_Run) */
const loadClips = () => clipsP || (clipsP = Promise.all([
    ...['General', 'MovementBasic'].map(f => loader.loadAsync(`assets/anims/Rig_Medium_${f}.glb`).then(g => g.animations)),
    fetch('assets/anims/mixamo.json').then(r => r.json()).then(js => js.map(j => THREE.AnimationClip.parse(j))).catch(() => [])])
  .then(lists => { const m = {}; lists.flat().forEach(c => { c.tracks = c.tracks.filter(t => !/^root\.position/.test(t.name)); m[c.name] = c; }); return m; }));

function lights(t) {
  const g = new THREE.Group();
  const add = (l, x, y, z) => { if (x !== undefined) l.position.set(x, y, z); g.add(l); };
  if (t === 'nightfall') {
    add(new THREE.HemisphereLight(0x6b5cff, 0x07070c, 1.1));
    add(new THREE.DirectionalLight(0x2ef2e0, 1.8), 3, 2, 3);
    add(new THREE.DirectionalLight(0x8b5cff, 4.5), -3, 3, -3);
  } else if (t === 'volt') {
    add(new THREE.HemisphereLight(0xffffff, 0x9aa0ad, 2.4));
    add(new THREE.DirectionalLight(0xffffff, 3.0), 1.5, 5, 4);
    add(new THREE.DirectionalLight(0xff3d2e, 3.0), -3, 2, -2);
  } else {
    add(new THREE.HemisphereLight(0xfff1e0, 0x2a2e3f, 2.2));
    add(new THREE.DirectionalLight(0xffffff, 2.4), 2, 4, 3);
    add(new THREE.DirectionalLight(0xff6b3d, 2.4), -3, 2, -2);
  }
  return g;
}
function prop(t, h) {
  if (t === 'nightfall') {
    const s = h * 0.1, m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshStandardMaterial({ color: 0x2ef2e0, emissive: 0x2ef2e0, emissiveIntensity: 1.4, roughness: .3 }));
    m.userData.spin = true; m.position.set(0, h * 0.05, 0); return m;
  }
  if (t === 'volt') {
    const g = new THREE.Group(), dark = new THREE.MeshStandardMaterial({ color: 0x0d0e12, roughness: .5 }), red = new THREE.MeshStandardMaterial({ color: 0xff3d2e, roughness: .4 });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(h * .012, h * .012, h * .2, 10), dark); bar.rotation.z = Math.PI / 2; g.add(bar);
    [-1, 1].forEach(k => { const p = new THREE.Mesh(new THREE.CylinderGeometry(h * .045, h * .045, h * .035, 18), k > 0 ? red : red); p.rotation.z = Math.PI / 2; p.position.x = k * h * .085; g.add(p); });
    return g;
  }
  return null;
}

const mounts = new Set();
class Mount {
  constructor(el) {
    this.el = el; this.mode = el.dataset.mode || 'you'; this.visible = true; this.ready = false;
    this.canvas = document.createElement('canvas'); this.canvas.className = 'av3d-cv'; el.appendChild(this.canvas);
    try {
      this.r = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch (e) { this.canvas.remove(); this.dead = true; return; }
    this.r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene(); this.cam = new THREE.PerspectiveCamera(28, 1, .1, 100);
    this.io = new IntersectionObserver(es => { this.visible = es[0].isIntersecting; }); this.io.observe(el);
    el.addEventListener('click', e => { if (this.mode !== 'cele') { e.stopPropagation(); this.play('tap'); } });
    mounts.add(this); this.load();
  }
  async load() {
    const name = getChar(); this.name = name;
    const [g, clips] = await Promise.all([loadChar(name), loadClips()]);
    if (this.dead || name !== getChar()) return;
    if (this.model) { this.scene.remove(this.model); }
    this.model = SkeletonUtils.clone(g.scene); this.clips = clips;
    this.model.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    const box = new THREE.Box3().setFromObject(this.model); this.h = box.max.y - box.min.y || 2;
    this.model.rotation.y = this.mode === 'path' ? .5 : -.35;
    this.scene.add(this.model);
    this.hand = null; this.model.traverse(o => { if (o.name === 'handslot.r' || o.name === 'handslotr') this.hand = o; });
    const sh = new THREE.Mesh(new THREE.CircleGeometry(this.h * .26, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .22, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = .005; this.scene.add(sh); if (this.shadow) this.scene.remove(this.shadow); this.shadow = sh;
    this.mixer = new THREE.AnimationMixer(this.model); this.cur = null;
    this.mixer.addEventListener('finished', () => this.play('idle'));
    this.applyTheme(); this.frame(); this.ready = true; this.el.classList.add('live');
    if (this.mode === 'cele') setTimeout(() => this.play('cheer'), 150);
  }
  frame() {
    const h = this.h, w = this.el.clientWidth || 100, hh = this.el.clientHeight || 120;
    this.r.setSize(w, hh, false); this.cam.aspect = w / hh;
    const full = h * 1.22, d = full / 2 / Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2));
    this.cam.position.set(0, h * .55, d * (this.cam.aspect < .8 ? 1 / this.cam.aspect * .8 : 1)); this.cam.lookAt(0, h * .5, 0); this.cam.updateProjectionMatrix();
  }
  applyTheme() {
    if (!this.model) return; const t = theme(); this.t = t;
    if (this.lights) this.scene.remove(this.lights); this.lights = lights(t); this.scene.add(this.lights);
    if (this.prop) this.prop.parent && this.prop.parent.remove(this.prop); this.prop = prop(t, this.h);
    if (this.prop && this.hand) this.hand.add(this.prop);
    this.play('idle', true);
  }
  play(kind, instant) {
    if (!this.mixer) return; const set = SETS[this.t] || SETS.dusk; if (kind === 'idle' && this.mode === 'path') kind = 'walk';
    const clip = this.clips[set[kind]] || this.clips[set.idle] || this.clips.Idle_A; if (!clip) return;
    const a = this.mixer.clipAction(clip); if (a === this.cur && (kind === 'idle' || kind === 'walk')) return;
    a.reset(); const loop = kind === 'idle' || kind === 'walk'; a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1); a.clampWhenFinished = false;
    if (this.cur && !instant) { a.crossFadeFrom(this.cur, .25, false); } a.play(); this.cur = a;
    if (kind === 'cheer' && this.mode === 'cele') { this.cheers = (this.cheers || 0) + 1; }
  }
  tick(dt) {
    if (!this.el.isConnected) { this.dispose(); return; }
    if (!this.ready || !this.visible || document.hidden) return;
    const w = this.el.clientWidth, h = this.el.clientHeight; if (w && (w !== this.w || h !== this.hgt)) { this.w = w; this.hgt = h; this.frame(); }
    this.mixer.update(dt); if (this.prop && this.prop.userData.spin) { this.prop.rotation.x += dt * 1.6; this.prop.rotation.y += dt * 2.1; }
    this.r.render(this.scene, this.cam);
  }
  dispose() { this.dead = true; mounts.delete(this); try { this.io.disconnect(); this.r.dispose(); this.r.forceContextLoss(); } catch (e) {} }
}

function scan(root = document) { root.querySelectorAll('.av3d:not([data-m])').forEach(el => { el.dataset.m = '1'; new Mount(el); }); }
let lastT = performance.now();
(function loop(now) { now = now || performance.now(); const dt = Math.min(.05, (now - lastT) / 1000); lastT = now; mounts.forEach(m => m.tick(dt)); requestAnimationFrame(loop); })();
new MutationObserver(() => scan()).observe(document.getElementById('app'), { childList: true, subtree: true });
new MutationObserver(() => mounts.forEach(m => m.applyTheme())).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

/* thumbnails for the player picker */
let thumbR = null;
async function thumb(name) {
  const [g, clips] = await Promise.all([loadChar(name), loadClips()]);
  if (!thumbR) { const c = document.createElement('canvas'); thumbR = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true }); thumbR.setSize(180, 220, false); thumbR.toneMapping = THREE.ACESFilmicToneMapping; }
  const s = new THREE.Scene(), m = SkeletonUtils.clone(g.scene), t = theme(); s.add(m); s.add(lights(t)); m.rotation.y = -.35;
  const mx = new THREE.AnimationMixer(m); const cl = clips[SETS[t].idle] || clips.Idle_A; mx.clipAction(cl).play(); mx.update(.4);
  const box = new THREE.Box3().setFromObject(m), h = box.max.y - box.min.y, cam = new THREE.PerspectiveCamera(28, 180 / 220, .1, 100);
  const d = h * 1.15 / 2 / Math.tan(THREE.MathUtils.degToRad(14)); cam.position.set(0, h * .55, d * 1.25); cam.lookAt(0, h * .5, 0);
  thumbR.render(s, cam); return thumbR.domElement.toDataURL('image/png');
}

window.Avatar3D = {
  CHARS, scan, thumb,
  setChar(n) { if (!CHARS[n]) return; localStorage.setItem('provn_char', JSON.stringify(n)); mounts.forEach(m => m.load()); },
  getChar
};
scan();
window.dispatchEvent(new Event('avatar3d-ready'));
