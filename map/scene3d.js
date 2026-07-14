// The System map's 3D isometric-style view. Three.js is bundled by Vite so
// renderer startup never depends on a third-party CDN at runtime. Universe
// stays on the 2D canvas (orbitmap.js); this module is only used for System.
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
// Plain THREE.Line/LineBasicMaterial can't actually get thicker than 1px in
// WebGL -- gl.lineWidth is capped at 1 on effectively every modern browser/
// GPU combination regardless of what's requested, a longstanding WebGL
// limitation, not a Three.js bug. Fat-line rendering (real screen-space
// pixel width) needs this "2" family of addons instead, which builds each
// segment as a camera-facing quad rather than relying on native GL lines.
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { hexEdgeWidths, hexCorners } from "../battle/hexmath.js";
import { ACCENT } from "../battle/colors.js";
import { chooseGraphicsQuality, GraphicsQuality } from "./renderQuality.js";

// Matches battle/colors.js's BOARD_TINT.gridCell -- the tone that actually
// covers most of the battle board (its hexes are filled with this, not
// BOARD_TINT.bg, which only shows through the thin gaps between them), so
// reusing it here is what makes this scene read as "the same background
// as battle" rather than the flat-black void the plain --bg value gave.
const BG_COLOR = 0x111624;
const RING_COLOR = 0x2a3350;
// Y heights of everything that lies flat on (or near) the ecliptic plane,
// deliberately spread far apart rather than clustered near 0 -- the
// OrthographicCamera's depth range is (1, 6000) (see camera below), so
// tight gaps like the 0.05 this scene used to use for orbit rings don't
// reliably resolve in the depth buffer at typical viewing distances and
// visibly z-fight/flicker against the gravity field (or each other) as the
// camera moves, rather than reading as "above" it. Ordered bottom to top:
// a gravity-field hex tint < orbit rings < sparse informational overlays
// < a ship's own flat hex token
// < the ship's raised 3D cone.
const GRAVITY_HEX_Y = 0.15;
const GRAVITY_LINE_Y = 0.22;
const ORBIT_RING_Y = 0.4;
const SPARSE_OVERLAY_Y = 0.65;
const SHIP_BASE_Y = 0.8;
const SHIP_BASE_EDGE_Y = 0.85;
const SHIP_HEIGHT_ABOVE_PLANE = 3;
const SHIP_FILL_ALPHA = 0.5;

export function createSystemScene({
  canvas, sizePx, minZoom, maxZoom, qualityPreference = "auto", onContextStatus = () => {},
}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);

  const halfView = sizePx / 2;
  const camera = new THREE.OrthographicCamera(-halfView, halfView, halfView, -halfView, 1, 6000);
  const DEFAULT_CAM_POS = new THREE.Vector3(520, 520, 520);
  camera.position.copy(DEFAULT_CAM_POS);
  camera.zoom = 1;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  // Default-framebuffer MSAA is an expensive context-creation choice and is
  // especially painful under software WebGL. The crisp tactical lines do not
  // rely on it, so keep it off and spend the budget on useful scene detail.
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, powerPreference: "high-performance",
  });
  const gl = renderer.getContext();
  let rendererName = "";
  try {
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    rendererName = String(gl.getParameter(
      debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER,
    ));
  } catch {
    rendererName = "";
  }
  const quality = chooseGraphicsQuality({
    rendererName,
    isWebGL2: renderer.capabilities.isWebGL2,
    maxTextureSize: renderer.capabilities.maxTextureSize,
    deviceMemory: navigator.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    coarsePointer: window.matchMedia?.("(pointer: coarse)").matches,
  }, qualityPreference);
  const lowQuality = quality === GraphicsQuality.LOW;
  const bodyWidthSegments = lowQuality ? 14 : 22;
  const bodyHeightSegments = lowQuality ? 10 : 16;
  const orbitSegments = lowQuality ? 36 : 72;
  const gravityLineWidth = lowQuality ? 2 : 3;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowQuality ? 1 : 2));
  renderer.setSize(sizePx, sizePx, false);
  canvas.dataset.renderer = "three";
  canvas.dataset.rendererState = "active";
  canvas.dataset.graphicsQuality = quality;

  scene.add(new THREE.AmbientLight(0x404050, 1.5));
  scene.add(new THREE.PointLight(0xfff2cc, 8, 0, 0)); // at the origin -- the Sun lights everything else

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

  const renderFrame = () => renderer.render(scene, camera);
  controls.addEventListener("change", renderFrame);

  const onContextLost = event => {
    event.preventDefault();
    canvas.dataset.rendererState = "lost";
    onContextStatus({ type: "lost", quality, rendererName });
  };
  const onContextRestored = () => {
    canvas.dataset.rendererState = "active";
    onContextStatus({ type: "restored", quality, rendererName });
    renderFrame();
  };
  canvas.addEventListener("webglcontextlost", onContextLost, false);
  canvas.addEventListener("webglcontextrestored", onContextRestored, false);

  const staticGroup = new THREE.Group();
  const dynamicGroup = new THREE.Group();
  scene.add(staticGroup);
  scene.add(dynamicGroup);
  const transientOverlayGroup = new THREE.Group();
  scene.add(transientOverlayGroup);
  const staticPickables = [];
  const dynamicPickables = [];
  const pickables = [];
  let buildGroup = staticGroup;
  let buildPickables = staticPickables;
  let staticBuildCount = 0;
  let dynamicBuildCount = 0;

  function clearGroup(group) {
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse?.(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    }
  }

  function clearSparseOverlays() {
    clearGroup(transientOverlayGroup);
    renderFrame();
  }

  // Real photo textures (solarsystemscope.com, CC BY 4.0 -- see
  // map/textures/) for the bodies that have one (the Sun, the 8 planets,
  // Earth's own Moon -- see BODY_TEXTURES in map/main.js); everything else
  // (every other moon, the belt) keeps its flat tinted-sphere look, same
  // as before textures existed. Loaded once per URL and cached here for
  // this scene's whole life so context restoration or a future static-scene
  // rebuild never refetches/re-decodes the same image. TextureLoader.load returns
  // immediately with a texture that fills in once the image actually
  // decodes (async) -- the onLoad callback re-renders that one frame so
  // the body doesn't sit blank until the *next* unrelated interaction
  // happens to trigger a redraw.
  const textureLoader = new THREE.TextureLoader();
  const textureCache = new Map();
  function getTexture(url) {
    if (!url) return null;
    if (!textureCache.has(url)) {
      const tex = textureLoader.load(url, renderFrame, undefined, error => {
        onContextStatus({ type: "asset-error", url, error, quality, rendererName });
      });
      tex.colorSpace = THREE.SRGBColorSpace;
      textureCache.set(url, tex);
    }
    return textureCache.get(url);
  }

  // A real body: the Sun, a planet, or a moon. `emissive` (the Sun) skips
  // *lit* shading -- it's the light source, not something lit by it, and
  // there's a PointLight sitting at this exact position (see above), so a
  // normal lit material would see every point on the sphere facing away
  // from its own light and render solid black. Driving the surface
  // entirely through the emissive channel (base color/map left black)
  // sidesteps that: emissive is a flat additive term Three.js applies
  // regardless of any light or surface normal, so the textured surface
  // reads the same brightness from every angle, same as a flat
  // MeshBasicMaterial would, but with the real photo's own detail instead
  // of a flat color. `y` (default 0, the shared orbital plane) is only
  // ever nonzero for a major moon with real inclination -- see
  // layoutSystemWithMoons in orbitmap.js.
  function addBody({ x, y = 0, z, radius, color, data, emissive, textureUrl }) {
    const r = Math.max(radius, 0.5);
    const geo = new THREE.SphereGeometry(r, bodyWidthSegments, bodyHeightSegments);
    const tex = getTexture(textureUrl);
    const mat = emissive
      ? new THREE.MeshStandardMaterial({
          color: 0x000000, emissive: tex ? 0xffffff : color, emissiveMap: tex, emissiveIntensity: 1.4,
          roughness: 1, metalness: 0,
        })
      : new THREE.MeshStandardMaterial({ color: tex ? 0xffffff : color, map: tex, roughness: 0.9, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.userData = data;
    buildGroup.add(mesh);
    buildPickables.push(mesh);
    return mesh;
  }

  // `tiltDeg` (default 0, flat) draws the ring rotated around its own
  // local X axis, matching a real-inclination moon's tilted orbital plane
  // (see layoutSystemWithMoons in orbitmap.js) instead of always lying flat.
  function addRing(cx, cz, radius, tiltDeg = 0) {
    if (radius < 1) return;
    const tiltRad = tiltDeg * Math.PI / 180;
    const pts = [];
    for (let i = 0; i <= orbitSegments; i++) {
      const a = (i / orbitSegments) * Math.PI * 2;
      const localX = Math.cos(a) * radius, localZ = Math.sin(a) * radius;
      pts.push(new THREE.Vector3(cx + localX, ORBIT_RING_Y - localZ * Math.sin(tiltRad), cz + localZ * Math.cos(tiltRad)));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: RING_COLOR, transparent: true, opacity: 0.4 });
    buildGroup.add(new THREE.Line(geo, mat));
  }

  // One ship, one small cone (a 3-sided cone reads as a simple triangular
  // hull) -- replaces the old addFleet's 3-cone "<" wedge, which stood in
  // for an entire "12" fleet as one stylized token. Now each of the 12
  // ships in a formation is its own individual token, hex-positioned (see
  // shipHexOffset in map/main.js), so this places exactly one. facingDeg
  // is the ship's real component facing (initially aimed toward the Sun),
  // applied via a quaternion rather than an Euler angle so there's no
  // manual sign-guessing about which way "positive rotation" goes in this
  // scene's particular axis convention.
  function addShip({ x, z, colorHex, data, selected, facingDeg, isFlag, isTarget, targetColor }) {
    // Grounded at the plane, not lifted -- unlike the old ring-only
    // marker, this group now holds both the flat hex token (which
    // should visibly rest on the orbital plane, at SHIP_BASE_Y) and the raised
    // cone (which shouldn't); lifting the whole group the way the cone
    // alone used to require would drag the token up with it, floating
    // it well above the sparse overlays/orbit rings instead of sitting on them.
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const s = 3;
    const geo = new THREE.ConeGeometry(s * 0.55, s * 1.6, 3);
    // The cone's own orientation already reads as a facing arrow, so the
    // flagship marker is just a color swap -- gold (ACCENT.flagshipArrow),
    // matching battle/render.js's flagship-arrow convention -- rather than
    // new geometry (this token is getting replaced by a real ship mesh
    // later, not worth a bigger investment now).
    const mat = new THREE.MeshStandardMaterial({ color: isFlag ? ACCENT.flagshipArrow : colorHex, roughness: 0.6 });
    const ship = new THREE.Mesh(geo, mat);
    ship.position.y = SHIP_HEIGHT_ABOVE_PLANE;
    const rad = facingDeg * Math.PI / 180;
    ship.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(Math.cos(rad), 0, Math.sin(rad)),
    );
    group.add(ship);
    // Selection outline takes priority over the target outline (a ship
    // can't be both at once anyway -- selected is the acting ship,
    // isTarget is some *other* ship it could fire at); target uses the
    // *attacker's* own color (targetColor, from map/main.js's
    // shipsSnapshot), not a fixed accent -- reads as "who can hit this"
    // and won't vanish against a same-colored hull.
    if (selected || isTarget) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: selected ? 0xffffff : targetColor }));
      edges.position.y = SHIP_HEIGHT_ABOVE_PLANE;
      edges.quaternion.copy(ship.quaternion);
      group.add(edges);
    }

    // The cone alone is a tiny, fiddly click target -- a flat hex beneath
    // it both shows where to click and IS the actual click target (no
    // separate invisible disc needed, since intersectObjects walks every
    // mesh in the group -- see resolveHit below). Filled translucent
    // (SHIP_FILL_ALPHA) in the faction color, same as the 2D fallback's
    // drawShip, so a tightly-packed formation still reads as individual
    // ships. Corner k sits at angle (60k-90) -- a pointy-top hex, same
    // orientation as the hex cell this ship already sits on (see
    // shipHexOffset in map/main.js). Sits at SHIP_BASE_Y, clear of both
    // the sparse overlays and orbit rings below it (see the Y-height comment
    // near SHIP_BASE_Y above) so it reads as a token resting on the
    // orbital plane, not floating at the cone's own height.
    const tapRadius = Math.max(s * 1.8, 3);
    const corners = hexCorners(0, 0, tapRadius);
    const fanPositions = [];
    for (let k = 0; k < 6; k++) {
      const [x1, z1] = corners[k], [x2, z2] = corners[(k + 1) % 6];
      fanPositions.push(0, SHIP_BASE_Y, 0, x1, SHIP_BASE_Y, z1, x2, SHIP_BASE_Y, z2);
    }
    const fanGeo = new THREE.BufferGeometry();
    fanGeo.setAttribute("position", new THREE.Float32BufferAttribute(fanPositions, 3));
    const hexMesh = new THREE.Mesh(
      fanGeo,
      new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: SHIP_FILL_ALPHA, side: THREE.DoubleSide }),
    );
    group.add(hexMesh);

    // Facing reads as edge thickness, not a separate arrow: the edge
    // pointing the ship's real facing is thickest (best-armored side),
    // the opposite edge thinnest (most vulnerable), the 4 side edges in
    // between -- see hexEdgeWidths in battle/hexmath.js. Edges sharing a
    // width are batched into one LineSegments2 each (3 objects, not 6),
    // since a LineMaterial's linewidth is per-material.
    const widths = hexEdgeWidths(facingDeg);
    for (const w of new Set(widths)) {
      const flat = [];
      for (let k = 0; k < 6; k++) {
        if (widths[k] !== w) continue;
        const [x1, z1] = corners[k], [x2, z2] = corners[(k + 1) % 6];
        flat.push(x1, SHIP_BASE_EDGE_Y, z1, x2, SHIP_BASE_EDGE_Y, z2);
      }
      const edgeGeo = new LineSegmentsGeometry();
      edgeGeo.setPositions(flat);
      const edgeMat = new LineMaterial({
        color: selected ? 0xffffff : (isTarget ? targetColor : colorHex), linewidth: w,
        resolution: new THREE.Vector2(sizePx, sizePx), transparent: true, opacity: selected || isTarget ? 1 : 0.9,
      });
      group.add(new LineSegments2(edgeGeo, edgeMat));
    }

    group.userData = data;
    buildGroup.add(group);
    buildPickables.push(group);
    return group;
  }

  // A single "1-hex asteroid" -- a real, individually-clickable obstacle
  // occupying exactly one hex cell (matches "each ship occupies 1 hex" --
  // see shipHexOffset in map/main.js), not a decorative particle. An
  // irregular low-poly rock (an icosahedron with each vertex nudged by a
  // small amount, deterministically seeded from its own world position so
  // the same asteroid looks the same on every static rebuild) rather than a
  // perfect gem, colored by the caller (map/main.js's FILL.belt) same as
  // every other body here.
  function addAsteroid({ x, z, radius, colorHex, data }) {
    const geo = new THREE.IcosahedronGeometry(radius, 0);
    let seed = Math.abs(Math.round(x * 131 + z * 977)) || 1;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const jitter = 1 + (rand() - 0.5) * 0.4;
      pos.setXYZ(i, pos.getX(i) * jitter, pos.getY(i) * jitter, pos.getZ(i) * jitter);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 1, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, SHIP_BASE_Y + radius * 0.6, z);
    mesh.rotation.set(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2);
    mesh.userData = data;
    buildGroup.add(mesh);
    buildPickables.push(mesh);
    return mesh;
  }

  // A shot's tracer: one straight line between firer and target, added
  // fresh to the dynamic group. That group is replaced each effect frame,
  // so a tracer simply not being re-added IS it disappearing; no separate
  // scene cleanup timer is needed here. `alpha`
  // (0..1, computed by the caller from the effect's own start/dur) drives
  // the actual fade -- map/main.js's ensureEffectLoop is what keeps calling
  // rebuilding the dynamic group with a shrinking alpha until the
  // effect expires, same as battle/render.js's own laser fade.
  function addTracer({ from, to, hit, alpha = 1 }) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from[0], SHIP_BASE_Y + 0.1, from[1]),
      new THREE.Vector3(to[0], SHIP_BASE_Y + 0.1, to[1]),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: hit ? 0xff3355 : 0x8899aa, transparent: true, opacity: 0.9 * alpha });
    buildGroup.add(new THREE.Line(geo, mat));
    if (hit) {
      // A wider, dimmer halo line underneath -- same "glow" idea as
      // battle/render.js's LINE_WIDTH.laserHitHalo double-stroke, done
      // here via a fatter LineSegments2 since plain THREE.Line has no
      // per-object line width.
      const haloGeo = new LineSegmentsGeometry();
      haloGeo.setPositions([from[0], SHIP_BASE_Y + 0.1, from[1], to[0], SHIP_BASE_Y + 0.1, to[1]]);
      const haloMat = new LineMaterial({
        color: 0xff3355, linewidth: 6, resolution: new THREE.Vector2(sizePx, sizePx),
        transparent: true, opacity: 0.5 * alpha,
      });
      buildGroup.add(new LineSegments2(haloGeo, haloMat));
    }
  }

  // One merged flat mesh covering every hex a single body's gravity
  // reaches, tinted that body's own color -- a big body's field can cover
  // a thousand-plus hexes (see gravityHexes in map/main.js), so this
  // batches all of them into one BufferGeometry/one draw call rather than
  // one mesh per hex. `triangles` is a flat array of
  // [x,z] pairs, 3 consecutive pairs per triangle -- map/main.js builds
  // it (via battle/hexmath.js's hexCorners, the same hex shape ship
  // tokens use) since this module doesn't know the hex grid's own size.
  //
  // `intensities` is a parallel 0..1-per-vertex array (map/main.js's
  // gravityHexIntensity) baked into each vertex's own color brightness
  // rather than true per-vertex alpha -- WebGL vertex-color alpha needs a
  // 4-component attribute and shader wiring this scene doesn't otherwise
  // use anywhere, while scaling RGB by intensity against this scene's
  // near-black background reads the same way a real alpha gradient would
  // (dimmer near the edge of a well's reach, full color deep inside it),
  // with one flat uniform opacity on the material underneath.
  function addGravityField({ triangles, intensities, lineSegments, lineIntensities, colorHex }) {
    const positions = [];
    const colors = [];
    const base = new THREE.Color(colorHex);
    for (let i = 0; i < triangles.length; i++) {
      positions.push(triangles[i][0], GRAVITY_HEX_Y, triangles[i][1]);
      const t = intensities[i];
      colors.push(base.r * t, base.g * t, base.b * t);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false,
    });
    buildGroup.add(new THREE.Mesh(geo, mat));

    // Thick local lattice lines carry the same cost gradient as the fill,
    // but their vertices are already pulled toward the relevant bodies by
    // map/main.js. LineSegments2 keeps the width real on WebGL hardware.
    const linePositions = [];
    const lineColors = [];
    for (let i = 0; i < lineSegments.length; i++) {
      linePositions.push(lineSegments[i][0], GRAVITY_LINE_Y, lineSegments[i][1]);
      const t = lineIntensities[i];
      lineColors.push(base.r * t, base.g * t, base.b * t);
    }
    const lineGeometry = new LineSegmentsGeometry();
    lineGeometry.setPositions(linePositions);
    lineGeometry.setColors(lineColors);
    const lineMaterial = new LineMaterial({
      color: 0xffffff, vertexColors: true, linewidth: gravityLineWidth,
      resolution: new THREE.Vector2(sizePx, sizePx), transparent: true, opacity: 0.95,
    });
    buildGroup.add(new LineSegments2(lineGeometry, lineMaterial));
  }

  function addHexLines(cells, hexSize, { color, opacity, linewidth }) {
    if (!cells.length) return;
    const flat = [];
    for (const cell of cells) {
      const corners = hexCorners(cell.x, cell.z, hexSize);
      for (let k = 0; k < 6; k++) {
        const [x1, z1] = corners[k], [x2, z2] = corners[(k + 1) % 6];
        flat.push(x1, SPARSE_OVERLAY_Y, z1, x2, SPARSE_OVERLAY_Y, z2);
      }
    }
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(flat);
    const material = new LineMaterial({
      color, linewidth, resolution: new THREE.Vector2(sizePx, sizePx), transparent: true, opacity,
    });
    transientOverlayGroup.add(new LineSegments2(geometry, material));
  }

  function addHexFills(cells, hexSize, { color, opacity }) {
    if (!cells.length) return;
    const positions = [];
    for (const cell of cells) {
      const corners = hexCorners(cell.x, cell.z, hexSize);
      for (let k = 0; k < 6; k++) {
        const [x1, z1] = corners[k], [x2, z2] = corners[(k + 1) % 6];
        positions.push(cell.x, SPARSE_OVERLAY_Y, cell.z, x1, SPARSE_OVERLAY_Y, z1, x2, SPARSE_OVERLAY_Y, z2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
    });
    transientOverlayGroup.add(new THREE.Mesh(geometry, material));
  }

  // Pointer movement only replaces this tiny group; bodies, textures,
  // gravity fields, asteroids, and ships stay in their retained groups.
  function updateSparseOverlays({ hoverCells = [], reachableCells = [], hoveredKey = null, colorHex, hexSize }) {
    clearGroup(transientOverlayGroup);
    addHexLines(hoverCells, hexSize, { color: 0x8892ab, opacity: 0.55, linewidth: 1 });
    if (colorHex) {
      const hovered = reachableCells.filter(cell => cell.key === hoveredKey);
      const normal = reachableCells.filter(cell => cell.key !== hoveredKey);
      addHexFills(normal, hexSize, { color: colorHex, opacity: 0.18 });
      addHexLines(normal, hexSize, { color: colorHex, opacity: 0.75, linewidth: 1.5 });
      addHexFills(hovered, hexSize, { color: colorHex, opacity: 0.42 });
      addHexLines(hovered, hexSize, { color: colorHex, opacity: 1, linewidth: 3 });
    }
    renderFrame();
  }

  function rebuildGroup(group, groupPickables, fn, api) {
    clearGroup(group);
    groupPickables.length = 0;
    buildGroup = group;
    buildPickables = groupPickables;
    fn(api);
    pickables.length = 0;
    pickables.push(...dynamicPickables, ...staticPickables);
    renderFrame();
  }

  function rebuildStatic(fn) {
    rebuildGroup(
      staticGroup, staticPickables, fn,
      { addBody, addRing, addAsteroid, addGravityField },
    );
    canvas.dataset.staticBuilds = String(++staticBuildCount);
  }
  function rebuildDynamic(fn) {
    rebuildGroup(
      dynamicGroup, dynamicPickables, fn,
      { addShip, addTracer },
    );
    canvas.dataset.dynamicBuilds = String(++dynamicBuildCount);
  }

  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function ndcFromEvent(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }
  // Walks up from whatever geometry the ray actually hit (e.g. a ship's
  // cone inside its own group) to the nearest ancestor carrying real
  // userData -- every pickable root sets `.kind`, individual child meshes don't.
  function resolveHit(object) {
    let o = object;
    while (o && !o.userData?.kind) o = o.parent;
    return o?.userData || null;
  }

  return {
    rebuildStatic,
    rebuildDynamic,
    renderFrame,
    updateSparseOverlays,
    clearSparseOverlays,
    // Whatever real body/fleet is under the cursor, or null. A ship always
    // wins over anything else the ray also hit -- chiefly the asteroid
    // belt's own invisible hit-torus, which spans a full ring around the
    // Sun at Y=0 and can end up spatially coincident with a ship that's
    // been moved into that radius band (via Set Course, say). Plain
    // nearest-surface order has no notion of "which pickable matters
    // more here", so without this a ship sitting on/near the belt was
    // unclickable -- the belt's own invisible ring, being the nearer
    // surface along that particular ray, ate the click first.
    pick(clientX, clientY) {
      raycaster.setFromCamera(ndcFromEvent(clientX, clientY), camera);
      const hits = raycaster.intersectObjects(pickables, true);
      if (!hits.length) return null;
      const shipHit = hits.find(h => resolveHit(h.object)?.kind === "ship");
      return resolveHit((shipHit || hits[0]).object);
    },
    // Where the cursor's ray crosses the orbital (Y=0) plane, in the same
    // world x/z units everything else uses -- e.g. for fleet movement.
    groundPoint(clientX, clientY) {
      raycaster.setFromCamera(ndcFromEvent(clientX, clientY), camera);
      const out = new THREE.Vector3();
      return raycaster.ray.intersectPlane(groundPlane, out) ? [out.x, out.z] : null;
    },
    zoomBy(factor) {
      camera.zoom = Math.max(minZoom, Math.min(maxZoom, camera.zoom * factor));
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
    diagnostics() {
      return {
        quality,
        rendererName,
        pixelRatio: renderer.getPixelRatio(),
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        staticBuildCount,
        dynamicBuildCount,
      };
    },
    dispose() {
      canvas.removeEventListener("webglcontextlost", onContextLost, false);
      canvas.removeEventListener("webglcontextrestored", onContextRestored, false);
      controls.dispose();
      clearGroup(transientOverlayGroup);
      clearGroup(dynamicGroup);
      clearGroup(staticGroup);
      for (const texture of textureCache.values()) texture.dispose();
      textureCache.clear();
      renderer.dispose();
      canvas.dataset.rendererState = "disposed";
    },
    controls,
    camera,
  };
}
