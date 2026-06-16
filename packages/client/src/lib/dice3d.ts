/* ============================================================
   The Tavern — real 3D dice that spin in place.
   three.js polyhedra, lit from above to match the candlelit room.
   Each face carries its own engraved number; the die tumbles on the
   spot (BG3-style) and settles with the server-resolved value facing
   the camera. Lazy-loaded so three stays out of the initial bundle.
   ============================================================ */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { diceGrid, DICE_SPACING, DICE_ROWGAP } from './diceLayout.js';

/** A real d10 / d100 die: the 10-faced pentagonal trapezohedron, as a convex hull. */
function d10Geometry(): THREE.BufferGeometry {
  const pts = [new THREE.Vector3(0, 1.05, 0), new THREE.Vector3(0, -1.05, 0)]; // poles
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i;                // 36° steps
    const y = i % 2 === 0 ? 0.28 : -0.28;       // zig-zag equator → kite faces
    pts.push(new THREE.Vector3(Math.cos(a) * 1.02, y, Math.sin(a) * 1.02));
  }
  const g = new ConvexGeometry(pts);
  g.scale(1.2, 1.2, 1.2);
  return g;
}

export type DieTheme = 'bone' | 'obsidian' | 'ember';
type Tint = DieTheme | 'crit' | 'fumble';

interface Pal { face: number; edge: number; num: string; glow: number; metal: number; rough: number }

const PALETTE: Record<Tint, Pal> = {
  bone:     { face: 0xe9dcc2, edge: 0x6b5836, num: '#2a1c0c', glow: 0xe08a4b, metal: 0.05, rough: 0.62 },
  obsidian: { face: 0x2a2420, edge: 0x0c0907, num: '#f4c98a', glow: 0xe08a4b, metal: 0.35, rough: 0.42 },
  ember:    { face: 0xd97b42, edge: 0x4a230f, num: '#2a1206', glow: 0xec9a5e, metal: 0.15, rough: 0.5 },
  crit:     { face: 0xe3b24a, edge: 0x5a3d12, num: '#3a2708', glow: 0xe8b765, metal: 0.4,  rough: 0.32 },
  fumble:   { face: 0x9c4d59, edge: 0x3c1a20, num: '#2a0e12', glow: 0xb6485a, metal: 0.25, rough: 0.44 },
};

function geometryFor(sides: number): THREE.BufferGeometry {
  switch (sides) {
    case 4:  return new THREE.TetrahedronGeometry(1.3);
    case 6:  return new THREE.BoxGeometry(1.7, 1.7, 1.7);
    case 8:  return new THREE.OctahedronGeometry(1.35);
    case 12: return new THREE.DodecahedronGeometry(1.3);
    case 20: return new THREE.IcosahedronGeometry(1.35);
    case 10:
    case 100: return d10Geometry();
    default: return new THREE.IcosahedronGeometry(1.35);
  }
}

interface Face { normal: THREE.Vector3; centroid: THREE.Vector3 }

/** Distinct flat faces of a convex polyhedron, merging coplanar triangles by normal. */
function extractFaces(geo: THREE.BufferGeometry): Face[] {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  // Group by normal *similarity*, not a rounded string key — string keys split a
  // face whose normal has a near-zero component into "0.00" vs "-0.00" (this was
  // putting two numbers on one d12 face).
  const groups: { normal: THREE.Vector3; verts: THREE.Vector3[] }[] = [];
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const cb = new THREE.Vector3(), ab = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let i = 0; i < triCount; i++) {
    const a = idx ? idx.getX(i * 3) : i * 3;
    const b = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
    const c = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
    va.fromBufferAttribute(pos, a); vb.fromBufferAttribute(pos, b); vc.fromBufferAttribute(pos, c);
    cb.subVectors(vc, vb); ab.subVectors(va, vb); normal.crossVectors(cb, ab).normalize();
    let g = groups.find((gr) => gr.normal.dot(normal) > 0.99); // same face if ~within 8°
    if (!g) { g = { normal: normal.clone(), verts: [] }; groups.push(g); }
    g.verts.push(va.clone(), vb.clone(), vc.clone());
  }
  return groups.map((g) => {
    const centroid = new THREE.Vector3();
    g.verts.forEach((v) => centroid.add(v));
    centroid.multiplyScalar(1 / g.verts.length);
    return { normal: g.normal, centroid };
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// A slight resting tilt: just enough that the die reads as 3D (you catch a sliver
// of the neighbouring faces) while the winning face stays squarely centred and
// facing the viewer. Keep it small — a big tilt made it unclear which face won.
const REST_TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.11, 0.14, 0));
const TMP_UP = new THREE.Vector3();
const TMP_RIGHT = new THREE.Vector3();
const WORLD_Y = new THREE.Vector3(0, 1, 0);
const WORLD_Z = new THREE.Vector3(0, 0, 1);

class Die {
  mesh: THREE.Group;
  private body: THREE.Mesh;
  private edges: THREE.LineSegments;
  private faces: Face[];
  private labels: { ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; mat: THREE.MeshBasicMaterial; quat: THREE.Quaternion }[] = [];
  /** Orientation that lands the result face flat against the camera. */
  restQ = new THREE.Quaternion();
  startQ = new THREE.Quaternion();
  tumbleAxis = new THREE.Vector3();
  spinTurns = 0;

  constructor(public sides: number, tint: Tint) {
    const pal = PALETTE[tint];
    const geo = geometryFor(sides);
    this.faces = extractFaces(geo);
    this.body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: pal.face, metalness: pal.metal, roughness: pal.rough, flatShading: true,
    }));
    this.edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo, 1),
      new THREE.LineBasicMaterial({ color: pal.edge, transparent: true, opacity: 0.85 }),
    );

    this.mesh = new THREE.Group();
    this.mesh.add(this.body, this.edges);

    // one number label per face, oriented flat on the face
    const labelSize = sides <= 6 ? 0.95 : sides <= 8 ? 0.8 : 0.66;
    this.faces.forEach((f) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(labelSize, labelSize), mat);

      // basis: plane +Z → face normal, +Y → a stable up tangent
      const n = f.normal;
      const upRef = Math.abs(n.y) < 0.92 ? WORLD_Y : WORLD_Z;
      TMP_RIGHT.crossVectors(upRef, n).normalize();
      TMP_UP.crossVectors(n, TMP_RIGHT).normalize();
      const m = new THREE.Matrix4().makeBasis(TMP_RIGHT, TMP_UP, n);
      const quat = new THREE.Quaternion().setFromRotationMatrix(m);
      plane.quaternion.copy(quat);
      plane.position.copy(f.centroid).addScaledVector(n, 0.012);
      this.mesh.add(plane);
      this.labels.push({ ctx, canvas, tex, mat, quat });
    });
  }

  /** Engrave the rolled value on face 0 (read at rest) and spread other values around. */
  setValues(result: number, tint: Tint): void {
    const pool: string[] = [];
    for (let v = 1; v <= this.sides; v++) if (v !== result) pool.push(String(v));
    this.applyFaces(String(result), pool, tint);
  }

  /** Label face 0 with `result` (read at rest); fill the rest from `pool`. */
  applyFaces(result: string, pool: string[], tint: Tint): void {
    const pal = PALETTE[tint];
    this.labels.forEach((l, i) => {
      const text = i === 0 ? result : pool.length ? pool[(i - 1) % pool.length]! : '';
      this.drawLabel(l, text, pal.num, i === 0 ? pal.glow : null); // face 0 = the winner, lit
    });
    // rest orientation: undo face 0's local frame so it sits flat & upright at
    // the camera, then add a gentle tilt so the die still reads as 3D
    this.restQ.copy(REST_TILT).multiply(_invQ.copy(this.labels[0]!.quat).invert());
  }

  private drawLabel(l: Die['labels'][number], text: string, color: string, glow: number | null): void {
    const c = l.ctx, s = l.canvas.width;
    c.clearRect(0, 0, s, s);
    const base = text.length > 1 ? 54 : 72;
    c.font = `700 ${glow ? base + 6 : base}px Spectral, Georgia, serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.shadowBlur = 0;
    c.lineWidth = 7;
    c.strokeStyle = 'rgba(0,0,0,0.30)';
    c.strokeText(text, s / 2, s / 2 + 4);
    // the winning face is lit so it's unmistakably the result, even at a glance
    if (glow) { c.shadowColor = `#${glow.toString(16).padStart(6, '0')}`; c.shadowBlur = 22; }
    c.fillStyle = color;
    c.fillText(text, s / 2, s / 2 + 4);
    c.shadowBlur = 0;
    // a faint underline disambiguates a lone 6 vs 9
    if (text === '6' || text === '9') {
      c.fillRect(s / 2 - 18, s / 2 + 30, 36, 5);
    }
    l.tex.needsUpdate = true;
  }

  retint(tint: Tint): void {
    const pal = PALETTE[tint];
    const bm = this.body.material as THREE.MeshStandardMaterial;
    bm.color.setHex(pal.face); bm.metalness = pal.metal; bm.roughness = pal.rough;
    (this.edges.material as THREE.LineBasicMaterial).color.setHex(pal.edge);
  }

  dim(): void {
    const bm = this.body.material as THREE.MeshStandardMaterial;
    bm.color.multiplyScalar(0.45); bm.opacity = 0.4; bm.transparent = true;
    (this.edges.material as THREE.LineBasicMaterial).opacity = 0.25;
    this.labels.forEach((l) => { l.mat.opacity = 0.35; });
  }

  /**
   * Orientation at progress `e` (0→1, already eased): a shortest-path turn from
   * the start toward the resting (result-facing) orientation, plus a few extra
   * whole turns that unwind to nothing by the end. Because it eases onto restQ
   * the whole way, the die just decelerates onto its value — no snap/correction.
   */
  orientAt(e: number): void {
    _base.slerpQuaternions(this.startQ, this.restQ, e);
    _spin.setFromAxisAngle(this.tumbleAxis, this.spinTurns * (1 - e) * Math.PI * 2);
    this.mesh.quaternion.multiplyQuaternions(_base, _spin);
  }
}

const _invQ = new THREE.Quaternion();
const _base = new THREE.Quaternion();
const _spin = new THREE.Quaternion();

export class DiceScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private diceGroup: THREE.Group;
  private dice: Die[] = [];
  private raf = 0;
  private theme: Tint = 'bone';
  private finals: number[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.camera.position.set(0, 0.4, 8);
    this.diceGroup = new THREE.Group();
    this.scene.add(this.diceGroup);

    this.scene.add(new THREE.AmbientLight(0xb89a72, 0.7));
    const key = new THREE.DirectionalLight(0xfff1dc, 1.5); // lit from above, warm
    key.position.set(-2, 5, 4);
    this.scene.add(key);
    const ember = new THREE.PointLight(0xe08a4b, 12, 30); // candle fill
    ember.position.set(3, -1, 3);
    this.scene.add(ember);

    this.resize();
  }

  // ponytail: render on demand only — the spin's own rAF drives frames; once the
  // dice land we render one final frame and stop, so the page can go idle.
  private render(): void { this.renderer.render(this.scene, this.camera); }

  resize(): void {
    const w = this.canvas.clientWidth || 320;
    const h = this.canvas.clientHeight || 210;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  /** Build the dice and tumble them in place, settling on `finals`. Resolves when landed. */
  async roll(opts: { sides: number; theme: DieTheme; finals: number[]; pairs?: boolean; speed?: number }): Promise<void> {
    this.theme = opts.theme;
    this.finals = opts.finals;
    this.diceGroup.clear();
    this.dice = [];
    if (opts.sides === 100) {
      // Real percentile dice: a tens d10 (00–90) + a units d10 (0–9), read together.
      this.buildPercentile(opts.finals[0] ?? 1, opts.theme);
    } else {
      // one die per roll (e.g. 3d20 → 3 dice), each settling on its own value
      opts.finals.forEach((value) => {
        const die = new Die(opts.sides, opts.theme);
        die.setValues(value, opts.theme);
        this.addDie(die);
      });
    }
    this.layoutDice(opts.sides !== 100 && !!opts.pairs);

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      this.dice.forEach((d) => d.mesh.quaternion.copy(d.restQ));
      this.render();
      return;
    }

    const speed = opts.speed ?? 1;
    const spinMs = 1300 / speed;

    await new Promise<void>((resolve) => {
      const t0 = performance.now();
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / spinMs);
        const e = 1 - (1 - k) ** 3; // ease-out: fast tumble that decelerates onto the value
        this.dice.forEach((d) => d.orientAt(e));
        this.render();
        if (k < 1) {
          this.raf = requestAnimationFrame(tick);
        } else {
          this.dice.forEach((d) => d.mesh.quaternion.copy(d.restQ));
          this.render();
          resolve();
        }
      };
      this.raf = requestAnimationFrame(tick);
    });
    await sleep(60);
  }

  /** Give a die its random tumble and add it to the row group. */
  private addDie(die: Die): void {
    die.tumbleAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    die.spinTurns = 2.5 + Math.random() * 1.5; // whole-ish turns of tumble before it settles
    die.startQ.set(Math.random(), Math.random(), Math.random(), Math.random()).normalize();
    die.orientAt(0);
    this.diceGroup.add(die.mesh);
    this.dice.push(die);
  }

  /**
   * Lay the dice out centred at a *fixed* die size and pull the camera back to
   * frame the whole grid, so each die stays the same on-screen size no matter how
   * many there are (the canvas grows with the grid instead of the dice shrinking).
   * Normal rolls wrap left-to-right; advantage pairs stack two rows per column.
   */
  private layoutDice(pairs: boolean): void {
    const n = this.dice.length;
    const { cols, rows } = diceGrid(n, pairs);
    this.dice.forEach((d, i) => {
      const col = pairs ? Math.floor(i / 2) % cols : i % cols;
      const row = pairs ? (i % 2) + 2 * Math.floor(i / (2 * cols)) : Math.floor(i / cols);
      d.mesh.position.set((col - (cols - 1) / 2) * DICE_SPACING, ((rows - 1) / 2 - row) * DICE_ROWGAP, 0);
    });

    // Pull the camera back so the grid fills ~82% of the view height.
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const gridH = rows * DICE_ROWGAP;
    const dist = gridH / 0.82 / (2 * Math.tan(vFov / 2));
    this.camera.position.set(0, 0.4, Math.max(dist, 4.5));
    this.camera.lookAt(0, 0, 0);

    // Safety: if the canvas got clamped narrower than the grid (small viewport),
    // shrink to avoid clipping. On a roomy canvas sized to the grid this stays 1.
    const visH = 2 * Math.tan(vFov / 2) * this.camera.position.length();
    const visW = visH * this.camera.aspect;
    this.diceGroup.scale.setScalar(Math.min(1, (visW * 0.82) / (cols * DICE_SPACING)));
  }

  /** Two d10s read as percentile: a tens die (00–90) beside a units die (0–9). */
  private buildPercentile(value: number, theme: DieTheme): void {
    const v = ((Math.round(value) - 1 + 100) % 100) + 1; // 1..100
    let tensLabel: string, unitsLabel: string;
    if (v === 100) { tensLabel = '00'; unitsLabel = '0'; }
    else { const u = v % 10; tensLabel = String(v - u).padStart(2, '0'); unitsLabel = String(u); }
    const tensAll = ['00', '10', '20', '30', '40', '50', '60', '70', '80', '90'];
    const unitsAll = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const tens = new Die(10, theme);
    tens.applyFaces(tensLabel, tensAll.filter((s) => s !== tensLabel), theme);
    const units = new Die(10, theme);
    units.applyFaces(unitsLabel, unitsAll.filter((s) => s !== unitsLabel), theme);
    this.addDie(tens);
    this.addDie(units);
  }

  /** Re-theme the kept die for a crit/fumble flourish. */
  setOutcome(index: number, kind: 'crit' | 'fumble'): void {
    const d = this.dice[index];
    if (!d) return;
    d.retint(kind);
    d.setValues(this.finals[index]!, kind);
    d.mesh.quaternion.copy(d.restQ); // setValues recomputes restQ; keep the face flat
    this.render();
  }

  /** Grey out a die dropped by advantage/disadvantage. */
  dropDie(index: number): void {
    this.dice[index]?.dim();
    this.render();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }
}
