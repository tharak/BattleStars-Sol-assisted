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
import { layeredFleetShipPositions } from "../battle/fleetShips.js";
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
const SHIP_FIRST_LAYER_HEIGHT = 1.3;
const SHIP_LAYER_SPACING = 1;
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
  const spinningBodies = [];
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
  // Earth's own Moon -- see BODY_TEXTURES in map/main.js); every other moon
  // keeps its flat tinted-sphere look, same
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
  function addBody({ x, y = 0, z, radius, color, data, emissive, textureUrl, spinDirection = 1, ownerColorHex = null }) {
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
    if (ownerColorHex) {
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(r * 1.3, r * 1.55, 32),
        new THREE.MeshBasicMaterial({ color: ownerColorHex, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
      );
      halo.position.set(x, ORBIT_RING_Y, z);
      halo.rotation.x = -Math.PI / 2;
      buildGroup.add(halo);
    }
    if (data?.kind === "star" || data?.kind === "planet") spinningBodies.push({ mesh, spinDirection });
    return mesh;
  }

  // `tiltDeg` (default 0, flat) draws the ring rotated around its own
  // local X axis, matching a real-inclination moon's tilted orbital plane
  // (see layoutSystemWithMoons in orbitmap.js) instead of always lying flat.
  function addRing(cx, cz, radius, tiltDeg = 0, color = RING_COLOR) {
    if (radius < 1) return;
    const tiltRad = tiltDeg * Math.PI / 180;
    const pts = [];
    for (let i = 0; i <= orbitSegments; i++) {
      const a = (i / orbitSegments) * Math.PI * 2;
      const localX = Math.cos(a) * radius, localZ = Math.sin(a) * radius;
      pts.push(new THREE.Vector3(cx + localX, ORBIT_RING_Y - localZ * Math.sin(tiltRad), cz + localZ * Math.cos(tiltRad)));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const geo = new THREE.TubeGeometry(curve, orbitSegments, Math.max(0.35, radius * 0.006), 6, true);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65 });
    buildGroup.add(new THREE.Mesh(geo, mat));
  }

  // A Fleet is one strategic entity and one selectable hex token. Its
  // Strength is rendered as a compact formation of smaller Ship cones
  // inside that token, so a loss immediately removes one visible Ship.
  function addShip({ x, z, colorHex, data, selected, facingDeg, strength = 4, formation = "sphere", isFlag, isTarget, targetColor, isGroupMember, hasActed, memberSlots = null, showBase = true }) {
    // Grounded at the plane, not lifted -- unlike the old ring-only
    // marker, this group now holds both the flat hex token (which
    // should visibly rest on the orbital plane, at SHIP_BASE_Y) and the raised
    // cone (which shouldn't); lifting the whole group the way the cone
    // alone used to require would drag the token up with it, floating
    // it well above the sparse overlays/orbit rings instead of sitting on them.
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const s = 2;
    const geo = new THREE.ConeGeometry(s * 0.22, s * 0.7, 3);
    const rad = facingDeg * Math.PI / 180;
    const allShipPositions = layeredFleetShipPositions({
      x: 0, z: 0, strength: memberSlots ? 57 : strength, spacing: 1.7,
      firstLayerHeight: SHIP_FIRST_LAYER_HEIGHT,
      layerSpacing: SHIP_LAYER_SPACING,
    });
    const slots = memberSlots || allShipPositions.map((_, slotIndex) => ({ slotIndex, member: null }));
    let leadShip = null;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const [shipX, shipY, shipZ] = allShipPositions[slot.slotIndex];
      const memberColor = slot.member?.isOriginalFlagship ? ACCENT.flagshipArrow
        : slot.member?.state === "routed" ? "#ff3355"
          : slot.member?.state === "shaken" ? "#ffd166" : colorHex;
      const mat = new THREE.MeshStandardMaterial({
        color: memberColor,
        roughness: 0.6,
      });
      const ship = new THREE.Mesh(geo, mat);
      ship.position.set(shipX, shipY, shipZ);
      ship.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(Math.cos(rad), 0, Math.sin(rad)),
      );
      group.add(ship);
      if (i === 0) leadShip = ship;
    }
    // Selection outline takes priority over the target outline (a ship
    // can't be both at once anyway -- selected is the acting ship,
    // isTarget is some *other* ship it could fire at); target uses the
    // *attacker's* own color (targetColor, from map/main.js's
    // shipsSnapshot), not a fixed accent -- reads as "who can hit this"
    // and won't vanish against a same-colored hull.
    if (selected || isTarget || isGroupMember) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: selected ? 0xffffff : (isTarget ? targetColor : ACCENT.flagshipArrow) }));
      edges.position.copy(leadShip.position);
      edges.quaternion.copy(leadShip.quaternion);
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
    if (!showBase) {
      group.userData = data;
      buildGroup.add(group);
      return group;
    }
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
        color: selected ? 0xffffff : (isTarget ? targetColor : (isGroupMember ? ACCENT.flagshipArrow : colorHex)), linewidth: w,
        resolution: new THREE.Vector2(sizePx, sizePx), transparent: true, opacity: selected || isTarget || isGroupMember ? 1 : 0.9,
      });
      group.add(new LineSegments2(edgeGeo, edgeMat));
    }

    group.userData = data;
    buildGroup.add(group);
    buildPickables.push(group);
    return group;
  }

  // A shot's tracer: one straight line between firer and target, added
  // fresh to the dynamic group. That group is replaced each effect frame,
  // so a tracer simply not being re-added IS it disappearing; no separate
  // scene cleanup timer is needed here. `alpha`
  // (0..1, computed by the caller from the effect's own start/dur) drives
  // the actual fade -- map/main.js's ensureEffectLoop is what keeps calling
  // rebuilding the dynamic group with a shrinking alpha until the
  // effect expires, same as battle/render.js's own laser fade.
  function addTracer({ from, to, hit, colorHex = "#ffffff", alpha = 1 }) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from[0], SHIP_BASE_Y + 0.1, from[1]),
      new THREE.Vector3(to[0], SHIP_BASE_Y + 0.1, to[1]),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: (hit ? 0.9 : 0.65) * alpha });
    buildGroup.add(new THREE.Line(geo, mat));
    if (hit) {
      // A wider, dimmer halo line underneath -- same "glow" idea as
      // battle/render.js's LINE_WIDTH.laserHitHalo double-stroke, done
      // here via a fatter LineSegments2 since plain THREE.Line has no
      // per-object line width.
      const haloGeo = new LineSegmentsGeometry();
      haloGeo.setPositions([from[0], SHIP_BASE_Y + 0.1, from[1], to[0], SHIP_BASE_Y + 0.1, to[1]]);
      const haloMat = new LineMaterial({
        color: colorHex, linewidth: 6, resolution: new THREE.Vector2(sizePx, sizePx),
        transparent: true, opacity: 0.5 * alpha,
      });
      buildGroup.add(new LineSegments2(haloGeo, haloMat));
    }
  }

  // Presentation-only member-Ship death burst. The caller supplies a
  // normalized progress value, so this never feeds time back into rules.
  function addExplosion({ x, z, slotIndex = 0, progress = 0, seed = 0 }) {
    const p = Math.max(0, Math.min(1, progress));
    const fade = 1 - p;
    const [burstX, burstY, burstZ] = layeredFleetShipPositions({
      x, z, strength: 57, spacing: 1.7,
      firstLayerHeight: SHIP_FIRST_LAYER_HEIGHT,
      layerSpacing: SHIP_LAYER_SPACING,
    })[slotIndex % 57];
    const coreRadius = 0.25 + Math.sin(Math.PI * p) * 0.9;
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(coreRadius, 8, 6),
      new THREE.MeshBasicMaterial({ color: p < 0.45 ? 0xfff1a8 : 0xff6b22, transparent: true, opacity: fade * 0.9 }),
    );
    core.position.set(burstX, burstY, burstZ);
    buildGroup.add(core);

    const rays = [];
    const rayCount = 7;
    for (let index = 0; index < rayCount; index++) {
      const angle = ((seed * 0.61803398875 + index / rayCount) % 1) * Math.PI * 2;
      const inner = 0.3 + p * 0.8;
      const outer = inner + 0.7 + p * 1.8;
      const rise = ((index % 3) - 1) * 0.25;
      rays.push(
        burstX + Math.cos(angle) * inner, burstY + rise * p, burstZ + Math.sin(angle) * inner,
        burstX + Math.cos(angle) * outer, burstY + rise * p, burstZ + Math.sin(angle) * outer,
      );
    }
    const rayGeo = new LineSegmentsGeometry();
    rayGeo.setPositions(rays);
    const rayMat = new LineMaterial({
      color: 0xffb02e, linewidth: 2.5, resolution: new THREE.Vector2(sizePx, sizePx),
      transparent: true, opacity: fade,
    });
    buildGroup.add(new LineSegments2(rayGeo, rayMat));
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
  function addGravityField({ triangles, intensities, lineSegments, lineIntensities, colorHex, arrowSegments = [] }) {
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

    if (arrowSegments.length) {
      const arrowPositions = [];
      for (const [x, z] of arrowSegments) arrowPositions.push(x, GRAVITY_LINE_Y + 0.03, z);
      const arrowGeometry = new LineSegmentsGeometry();
      arrowGeometry.setPositions(arrowPositions);
      const arrowMaterial = new LineMaterial({
        color: new THREE.Color(colorHex), linewidth: gravityLineWidth, resolution: new THREE.Vector2(sizePx, sizePx),
        transparent: true, opacity: 0.95,
      });
      buildGroup.add(new LineSegments2(arrowGeometry, arrowMaterial));
    }
  }

  function addTransportField({ segments = [], nodes = [] }) {
    if (segments.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(
        segments.flatMap(([x1, z1, x2, z2]) => [x1, 0.08, z1, x2, 0.08, z2]), 3,
      ));
      buildGroup.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        color: 0x38d9ff, transparent: true, opacity: 0.8,
      })));
    }
    if (nodes.length) addHexLines(nodes, 5, { color: 0xffb02e, opacity: 1, linewidth: 2.5 });
  }

  function addHexLines(cells, hexSize, { color, opacity, linewidth, projectPoint = (x, z) => [x, z] }) {
    if (!cells.length) return;
    const flat = [];
    for (const cell of cells) {
      const corners = hexCorners(cell.x, cell.z, hexSize).map(([x, z]) => projectPoint(x, z));
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

  function addHexFills(cells, hexSize, { color, opacity, projectPoint = (x, z) => [x, z] }) {
    if (!cells.length) return;
    const positions = [];
    for (const cell of cells) {
      const [centerX, centerZ] = projectPoint(cell.x, cell.z);
      const corners = hexCorners(cell.x, cell.z, hexSize).map(([x, z]) => projectPoint(x, z));
      for (let k = 0; k < 6; k++) {
        const [x1, z1] = corners[k], [x2, z2] = corners[(k + 1) % 6];
        positions.push(centerX, SPARSE_OVERLAY_Y, centerZ, x1, SPARSE_OVERLAY_Y, z1, x2, SPARSE_OVERLAY_Y, z2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
    });
    transientOverlayGroup.add(new THREE.Mesh(geometry, material));
  }

  function addCourseLines(lines, projectPoint = (x, z) => [x, z]) {
    for (const line of lines) {
      const [fromX, fromZ] = projectPoint(line.from.x, line.from.z);
      const [toX, toZ] = projectPoint(line.to.x, line.to.z);
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(fromX, SPARSE_OVERLAY_Y, fromZ),
        new THREE.Vector3(toX, SPARSE_OVERLAY_Y, toZ),
      ]);
      transientOverlayGroup.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({
        color: line.colorHex, transparent: true, opacity: 0.8,
      })));
    }
  }

  // Pointer movement only replaces this tiny group; bodies, textures,
  // gravity fields, and ships stay in their retained groups.
  function updateSparseOverlays({ boardCells = [], transportCells = [], commandCells = [], hoverCells = [], reachableCells = [], courseCells = [], courseLines = [], hoveredKey = null, colorHex, hexSize, projectPoint }) {
    clearGroup(transientOverlayGroup);
    addHexLines(boardCells, hexSize, { color: 0x53617c, opacity: 0.34, linewidth: 1, projectPoint });
    addHexLines(transportCells, hexSize, { color: 0x38d9ff, opacity: 0.7, linewidth: 2, projectPoint });
    addHexFills(transportCells.filter(cell => cell.ambush), hexSize, { color: 0xffb02e, opacity: 0.28, projectPoint });
    addHexLines(transportCells.filter(cell => cell.ambush), hexSize, { color: 0xffb02e, opacity: 1, linewidth: 2.5, projectPoint });
    addCourseLines(courseLines, projectPoint);
    if (colorHex) {
      addHexFills(commandCells, hexSize, { color: colorHex, opacity: 0.035, projectPoint });
      addHexLines(commandCells, hexSize, { color: colorHex, opacity: 0.2, linewidth: 1, projectPoint });
    }
    addHexLines(hoverCells, hexSize, { color: 0x8892ab, opacity: 0.55, linewidth: 1, projectPoint });
    addHexFills(courseCells, hexSize, { color: ACCENT.flagshipArrow, opacity: 0.2, projectPoint });
    addHexLines(courseCells, hexSize, { color: ACCENT.flagshipArrow, opacity: 1, linewidth: 3, projectPoint });
    if (colorHex) {
      const hovered = reachableCells.filter(cell => cell.key === hoveredKey);
      const normal = reachableCells.filter(cell => cell.key !== hoveredKey);
      addHexFills(normal, hexSize, { color: colorHex, opacity: 0.18, projectPoint });
      addHexLines(normal, hexSize, { color: colorHex, opacity: 0.75, linewidth: 1.5, projectPoint });
      addHexFills(hovered, hexSize, { color: colorHex, opacity: 0.42, projectPoint });
      addHexLines(hovered, hexSize, { color: colorHex, opacity: 1, linewidth: 3, projectPoint });
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
    spinningBodies.length = 0;
    rebuildGroup(
      staticGroup, staticPickables, fn,
      { addBody, addRing, addGravityField, addTransportField },
    );
    canvas.dataset.staticBuilds = String(++staticBuildCount);
  }
  function rebuildDynamic(fn) {
    rebuildGroup(
      dynamicGroup, dynamicPickables, fn,
      { addShip, addTracer, addExplosion },
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
    animateBodies(nowMs) {
      // A readable game-rate spin, not real-time day length.  It matches the
      // direction of the tactical current marker supplied by map/main.js.
      for (const { mesh, spinDirection } of spinningBodies) mesh.rotation.y = spinDirection * nowMs / 9000;
      renderFrame();
    },
    updateSparseOverlays,
    clearSparseOverlays,
    // Whatever real body/fleet is under the cursor, or null. Prefer a ship
    // when multiple retained objects overlap the same ray.
    pick(clientX, clientY) {
      raycaster.setFromCamera(ndcFromEvent(clientX, clientY), camera);
      const hits = raycaster.intersectObjects(pickables, true);
      if (!hits.length) return null;
      const fleetHit = hits.find(h => resolveHit(h.object)?.kind === "fleet");
      return resolveHit((fleetHit || hits[0]).object);
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
    // Roster selection keeps the current viewing angle and zoom while
    // translating the camera onto one strategic-map position.
    panTo(x, z) {
      const offset = camera.position.clone().sub(controls.target);
      controls.target.set(x, 0, z);
      camera.position.copy(controls.target).add(offset);
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
