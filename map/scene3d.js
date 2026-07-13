// The System map's 3D isometric-style view: a real WebGL scene (Three.js,
// loaded via the importmap in map.html -- no local install, matching this
// repo's zero-build-step setup) instead of the flat 2D canvas the rest of
// the app uses. Universe/Formation/Battle stay on the 2D canvas (hexgrid.js
// / orbitmap.js) -- this module is only ever used for the System level.
//
// Positions/sizes come in as plain (x,z,radius) world units from the
// caller (map/main.js reuses layoutSystemWithMoons's real-distance/real-
// size math from orbitmap.js) -- this module only owns the 3D rendering
// and camera, not the astronomy. Bodies sit on the Y=0 plane (the
// ecliptic); an OrthographicCamera keeps the view free of perspective
// distortion (the "isometric" look) while OrbitControls lets it rotate
// freely with the mouse, which a strict fixed-angle isometric camera
// wouldn't allow. Mouse buttons: middle-drag rotates, right-drag pans
// (ground-plane-flattened, same as the arrow keys), wheel zooms toward
// the cursor. Left is deliberately unbound here -- map/main.js uses it
// for clicking bodies/fleets, and it's reserved for click-and-drag
// control of them later.
//
// World-space sizes are zoom-invariant by construction here -- unlike the
// old 2D canvas version, where a moon's on-screen px size and a planet's
// were independently clamped and could converge at some zoom levels, an
// orthographic camera's zoom scales the *whole* projected view uniformly,
// so a moon sphere can never out-grow its planet's sphere relative to it,
// at any zoom, with no extra clamping logic needed.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
// Plain THREE.Line/LineBasicMaterial can't actually get thicker than 1px in
// WebGL -- gl.lineWidth is capped at 1 on effectively every modern browser/
// GPU combination regardless of what's requested, a longstanding WebGL
// limitation, not a Three.js bug. Fat-line rendering (real screen-space
// pixel width) needs this "2" family of addons instead, which builds each
// segment as a camera-facing quad rather than relying on native GL lines.
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

// Matches battle/colors.js's BOARD_TINT.gridCell -- the tone that actually
// covers most of the battle board (its hexes are filled with this, not
// BOARD_TINT.bg, which only shows through the thin gaps between them), so
// reusing it here is what makes this scene read as "the same background
// as battle" rather than the flat-black void the plain --bg value gave.
const BG_COLOR = 0x111624;
const RING_COLOR = 0x2a3350;
const GRID_COLOR = 0x39ff14; // neon green -- deliberately loud against BG_COLOR, unlike RING_COLOR
const SHIP_HEIGHT_ABOVE_PLANE = 1.2;

export function createSystemScene({ canvas, labelContainer, sizePx, minZoom, maxZoom }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);

  const halfView = sizePx / 2;
  const camera = new THREE.OrthographicCamera(-halfView, halfView, halfView, -halfView, 1, 6000);
  const DEFAULT_CAM_POS = new THREE.Vector3(520, 520, 520);
  camera.position.copy(DEFAULT_CAM_POS);
  camera.zoom = 1;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(sizePx, sizePx, false);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(sizePx, sizePx);
  Object.assign(labelRenderer.domElement.style, { position: "absolute", top: "0", left: "0", pointerEvents: "none" });
  labelContainer.appendChild(labelRenderer.domElement);

  scene.add(new THREE.AmbientLight(0x404050, 1.5));
  scene.add(new THREE.PointLight(0xfff2cc, 3.5, 0, 0)); // at the origin -- the Sun lights everything else

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.minZoom = minZoom;
  controls.maxZoom = maxZoom;
  controls.minPolarAngle = 0.08;
  controls.maxPolarAngle = Math.PI - 0.08;
  controls.minDistance = 10;
  controls.maxDistance = 4000;
  // Zoom toward wherever the cursor is (native to this camera type/Three
  // version) rather than always toward the view center.
  controls.zoomToCursor = true;
  // Left-drag rotates (also the button map/main.js's click handler uses to
  // select/focus bodies and fleets -- see the "start"/"change"/"end" event
  // wiring below that lets it tell a rotate-drag apart from a real click);
  // right-drag pans (screenSpacePanning false keeps that pan flat on the
  // ground plane, the same math the arrow keys use in panCamera() below,
  // rather than tilting with the camera).
  controls.screenSpacePanning = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: null, RIGHT: THREE.MOUSE.PAN };
  canvas.addEventListener("contextmenu", ev => ev.preventDefault());

  const renderFrame = () => {
    // CSS2DRenderer sets element.style.display itself from each object's
    // own .visible flag every render call (and would silently clobber a
    // directly-set style.display right back to visible), so toggle .visible
    // instead of touching the DOM style directly.
    for (const { lbl, r } of bodyLabels) lbl.visible = r * camera.zoom > MIN_LABEL_PX;
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  };
  controls.addEventListener("change", renderFrame);

  const objectGroup = new THREE.Group();
  scene.add(objectGroup);
  let pickables = [];
  // Body (not fleet) labels: only shown once the body's on-screen size
  // clears MIN_LABEL_PX, same idea as the old 2D canvas's labelMinPx --
  // otherwise, with ~160 moons' worth of labels always on, the default
  // zoomed-out view is unreadable clutter. Re-checked every frame (not
  // just on rebuild) since camera.zoom changes continuously via wheel/-/=
  // without a full scene rebuild.
  const MIN_LABEL_PX = 3;
  let bodyLabels = [];

  function clearObjects() {
    for (const child of [...objectGroup.children]) {
      objectGroup.remove(child);
      child.traverse?.(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    }
    pickables = [];
    bodyLabels = [];
  }

  function makeLabel(text) {
    const div = document.createElement("div");
    div.textContent = text;
    Object.assign(div.style, {
      font: "bold 11px system-ui", color: "#d7deef", textShadow: "0 1px 3px #000",
      transform: "translate(-50%, 2px)", whiteSpace: "nowrap", pointerEvents: "none",
    });
    return new CSS2DObject(div);
  }

  // A real body: the Sun, a planet, or a moon. `emissive` (the Sun) skips
  // lighting -- it's the light source, not something lit by it. `y`
  // (default 0, the shared orbital plane) is only ever nonzero for a major
  // moon with real inclination -- see layoutSystemWithMoons in orbitmap.js.
  function addBody({ x, y = 0, z, radius, color, label, data, emissive }) {
    const r = Math.max(radius, 0.5);
    const geo = new THREE.SphereGeometry(r, 22, 16);
    const mat = emissive
      ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.userData = data;
    objectGroup.add(mesh);
    if (label) {
      const lbl = makeLabel(label);
      lbl.position.set(0, r + 3, 0);
      mesh.add(lbl);
      bodyLabels.push({ lbl, r });
    }
    pickables.push(mesh);
    return mesh;
  }

  // `tiltDeg` (default 0, flat) draws the ring rotated around its own
  // local X axis, matching a real-inclination moon's tilted orbital plane
  // (see layoutSystemWithMoons in orbitmap.js) instead of always lying flat.
  function addRing(cx, cz, radius, tiltDeg = 0) {
    if (radius < 1) return;
    const tiltRad = tiltDeg * Math.PI / 180;
    const pts = [];
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const localX = Math.cos(a) * radius, localZ = Math.sin(a) * radius;
      pts.push(new THREE.Vector3(cx + localX, 0.05 - localZ * Math.sin(tiltRad), cz + localZ * Math.cos(tiltRad)));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: RING_COLOR, transparent: true, opacity: 0.4 });
    objectGroup.add(new THREE.Line(geo, mat));
  }

  // A fleet isn't a real orbiting body -- 3 small ship-cone meshes (a
  // 3-sided cone reads as a simple triangular hull) in a "<" wedge, all
  // pointing left, matching the 2D view's ship-arrow icon.
  function addFleet({ x, z, colorHex, label, data, selected }) {
    const group = new THREE.Group();
    group.position.set(x, SHIP_HEIGHT_ABOVE_PLANE, z);
    const s = 6;
    const offsets = [[-s * 1.1, 0], [s * 0.55, -s * 1.05], [s * 0.55, s * 1.05]];
    for (const [dx, dz] of offsets) {
      const geo = new THREE.ConeGeometry(s * 0.55, s * 1.6, 3);
      const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.6 });
      const ship = new THREE.Mesh(geo, mat);
      // A cone points along +Y by default; lay it flat in the XZ plane
      // and aim its tip along -X (the "<" direction).
      ship.rotation.z = Math.PI / 2;
      ship.position.set(dx, 0, dz);
      group.add(ship);
      if (selected) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff }));
        edges.rotation.copy(ship.rotation);
        edges.position.copy(ship.position);
        group.add(edges);
      }
    }
    // The 3 ship cones alone are a tiny, fiddly click target -- a visible
    // ring around the whole wedge both shows where to click and (via the
    // matching invisible disc just inside it) IS the actual click target,
    // the same generous tap radius the 2D fallback's drawFleet uses.
    const tapRadius = Math.max(s * 1.8, 10);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(tapRadius * 0.92, tapRadius, 32),
      new THREE.MeshBasicMaterial({ color: selected ? 0xffffff : colorHex, transparent: true, opacity: selected ? 0.9 : 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    const hitDisc = new THREE.Mesh(
      new THREE.CircleGeometry(tapRadius, 24),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
    );
    hitDisc.rotation.x = -Math.PI / 2;
    group.add(hitDisc);

    group.userData = data;
    objectGroup.add(group);
    const lbl = makeLabel(label);
    lbl.position.set(0, s * 1.3, 0);
    group.add(lbl);
    pickables.push(group);
    return group;
  }

  // A decorative, non-individually-clickable scatter of small particles
  // (the asteroid belt -- see beltParticles in orbits.js) drawn as one
  // THREE.Points cloud, a single draw call regardless of how many points
  // there are. Clicking the belt hits a separate invisible torus spanning
  // its real inner/outer radius (added to pickables, resolving to `data`
  // the same way everything else does) rather than raycasting against
  // individual points, which would be both slower and a much fiddlier
  // click target than "anywhere in the visible band".
  function addAsteroidBelt({ points, colorHex, innerPx, outerPx, data }) {
    const positions = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: colorHex, size: 1.6, sizeAttenuation: false });
    objectGroup.add(new THREE.Points(geo, mat));

    const midRadius = (innerPx + outerPx) / 2;
    const hit = new THREE.Mesh(
      new THREE.TorusGeometry(midRadius, (outerPx - innerPx) / 2 + 3, 8, 48),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
    );
    hit.rotation.x = -Math.PI / 2;
    hit.userData = data;
    objectGroup.add(hit);
    pickables.push(hit);
  }

  // The "rubber sheet" spacetime-curvature grid: a flat reference grid
  // across the ecliptic plane that dips toward -Y near each massive body
  // (`wells`, [{x,z,rPx}]), Sun deepest -- the standard classroom gravity-
  // well picture. Not a real general-relativity computation (there isn't
  // one that maps cleanly onto a handful of orbit-plane bodies at this
  // scale); `rPx`, the body's already-computed rendered radius, just
  // stands in for "how much this body should dent the sheet" so bigger
  // reads as heavier, same as the eye already expects from its size.
  // Doubles as texture that keeps the scene from reading as a flat black
  // void, same job battle's hex grid does for its own board.
  function addSpacetimeGrid({ size, divisions, wells }) {
    const half = size / 2;
    const step = size / divisions;
    // falloff (how far the dip reaches) scales with the body's own radius
    // but tightly, and strength (how deep) is deliberately way past any
    // real proportion -- this is a legibility exaggeration, not a
    // to-scale one, the same call already made for planet/moon sizes
    // elsewhere in this view. Un-exaggerated, the dip was too shallow and
    // too wide to read as curvature at all.
    const depthAt = (x, z) => {
      let y = 0;
      for (const w of wells) {
        const dx = x - w.x, dz = z - w.z;
        const falloff = Math.max(w.rPx * 2, 20);
        const strength = w.rPx * 9;
        y -= strength / (1 + (dx * dx + dz * dz) / (falloff * falloff));
      }
      return y;
    };
    const rows = [];
    for (let i = 0; i <= divisions; i++) {
      const z = -half + i * step;
      const row = [];
      for (let j = 0; j <= divisions; j++) {
        const x = -half + j * step;
        row.push(new THREE.Vector3(x, depthAt(x, z), z));
      }
      rows.push(row);
    }
    const flat = [];
    for (let i = 0; i <= divisions; i++) {
      for (let j = 0; j <= divisions; j++) {
        if (j < divisions) { flat.push(...rows[i][j], ...rows[i][j + 1]); }
        if (i < divisions) { flat.push(...rows[i][j], ...rows[i + 1][j]); }
      }
    }
    const geo = new LineSegmentsGeometry();
    geo.setPositions(flat);
    // linewidth is in screen pixels (worldUnits defaults to false), so the
    // grid stays a constant, clearly-visible thickness at any zoom level --
    // resolution has to be supplied in pixels for that math to work, since
    // this is a fake "line" built from camera-facing quads, not a real GL
    // line primitive.
    const mat = new LineMaterial({
      color: GRID_COLOR, linewidth: 2, resolution: new THREE.Vector2(sizePx, sizePx),
      transparent: true, opacity: 0.6,
    });
    objectGroup.add(new LineSegments2(geo, mat));
  }

  // The fleet movement-range hex picker (see map/movegrid.js): fixed-
  // pixel-size hexes on the ecliptic plane around a selected fleet, each
  // one its own pickable carrying the real km destination straight in
  // userData (`hexes` already has dx/dy render offsets and xKm/yKm
  // computed by movegrid.js -- this function only draws them). Fainter
  // with more turns so distance-in-turns reads at a glance without
  // needing a label on every tile.
  function addHexOverlay({ centerX, centerZ, hexes, sizePx, colorHex }) {
    const y = 0.3;
    for (const h of hexes) {
      const cx = centerX + h.dx, cz = centerZ + h.dy;
      const corners = [];
      for (let k = 0; k < 6; k++) {
        const a = (60 * k - 90) * Math.PI / 180;
        corners.push([cx + Math.cos(a) * sizePx, cz + Math.sin(a) * sizePx]);
      }
      const verts = [];
      for (let k = 0; k < 6; k++) {
        const [x1, z1] = corners[k], [x2, z2] = corners[(k + 1) % 6];
        verts.push(cx, y, cz, x1, y, z1, x2, y, z2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: colorHex, transparent: true, opacity: 0.5 / h.turns,
          side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      mesh.userData = { kind: "movehex", xKm: h.xKm, yKm: h.yKm, turns: h.turns, hours: h.hours };
      objectGroup.add(mesh);
      pickables.push(mesh);

      const borderPts = corners.map(([x, z]) => new THREE.Vector3(x, y + 0.02, z));
      borderPts.push(borderPts[0]);
      const border = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(borderPts),
        new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: Math.min(1, 1.1 / h.turns) }),
      );
      objectGroup.add(border);
    }
  }

  function rebuild(fn) {
    clearObjects();
    fn({ addBody, addRing, addFleet, addAsteroidBelt, addSpacetimeGrid, addHexOverlay });
    renderFrame();
  }

  const raycaster = new THREE.Raycaster();
  function ndcFromEvent(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }
  // Walks up from whatever geometry the ray actually hit (e.g. one ship's
  // cone inside a fleet's group) to the nearest ancestor carrying real
  // userData -- every pickable root sets `.kind`, ship/label children don't.
  function resolveHit(object) {
    let o = object;
    while (o && !o.userData?.kind) o = o.parent;
    return o?.userData || null;
  }

  return {
    rebuild,
    renderFrame,
    // Whatever real body/fleet is under the cursor, or null.
    // Movement-range hex tiles (map/movegrid.js) sit on the same flat
    // ecliptic plane as other large, mostly-invisible click targets like
    // the asteroid belt's hit-torus -- from some camera angles a ray
    // toward a hex can graze the belt's torus at a nearly identical
    // depth and win the raw closest-hit comparison, stealing the click.
    // Hexes only ever exist while they're the thing the player is
    // actively meant to click (a fleet is selected), so give them
    // priority over whatever else the ray happens to also cross.
    pick(clientX, clientY) {
      raycaster.setFromCamera(ndcFromEvent(clientX, clientY), camera);
      const hits = raycaster.intersectObjects(pickables, true);
      if (!hits.length) return null;
      const resolved = hits.map(h => resolveHit(h.object)).filter(Boolean);
      return resolved.find(r => r.kind === "movehex") || resolved[0];
    },
    zoomBy(factor) {
      camera.zoom = Math.max(minZoom, Math.min(maxZoom, camera.zoom * factor));
      camera.updateProjectionMatrix();
      controls.update();
      renderFrame();
    },
    focusOn(x, z, zoom) {
      controls.target.set(x, 0, z);
      camera.zoom = Math.max(camera.zoom, zoom);
      camera.updateProjectionMatrix();
      controls.update();
      renderFrame();
    },
    resetCamera() {
      controls.target.set(0, 0, 0);
      camera.position.copy(DEFAULT_CAM_POS);
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      controls.update();
      renderFrame();
    },
    // Arrow-key panning: move the camera and its orbit target together,
    // along the camera's own on-screen right/"up" directions flattened
    // onto the ground plane, so the keys always move the view the way
    // they look regardless of current rotation.
    panCamera(dRight, dUp) {
      const right = new THREE.Vector3(), forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0; forward.normalize();
      right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
      const offset = right.multiplyScalar(dRight).add(forward.multiplyScalar(dUp));
      camera.position.add(offset);
      controls.target.add(offset);
      controls.update();
      renderFrame();
    },
    controls,
    camera,
  };
}
