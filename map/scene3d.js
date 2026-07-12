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
// wouldn't allow.
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

const BG_COLOR = 0x0b0e14;
const RING_COLOR = 0x2a3350;
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
  controls.enablePan = false; // arrow keys pan instead -- see panCamera()
  controls.enableDamping = false;
  controls.minZoom = minZoom;
  controls.maxZoom = maxZoom;
  controls.minPolarAngle = 0.08;
  controls.maxPolarAngle = Math.PI - 0.08;
  controls.minDistance = 10;
  controls.maxDistance = 4000;

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
  // lighting -- it's the light source, not something lit by it.
  function addBody({ x, z, radius, color, label, data, emissive }) {
    const r = Math.max(radius, 0.5);
    const geo = new THREE.SphereGeometry(r, 22, 16);
    const mat = emissive
      ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0, z);
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

  function addRing(cx, cz, radius) {
    if (radius < 1) return;
    const pts = [];
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      pts.push(new THREE.Vector3(cx + Math.cos(a) * radius, 0.05, cz + Math.sin(a) * radius));
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
    group.userData = data;
    objectGroup.add(group);
    const lbl = makeLabel(label);
    lbl.position.set(0, s * 1.3, 0);
    group.add(lbl);
    pickables.push(group);
    return group;
  }

  function rebuild(fn) {
    clearObjects();
    fn({ addBody, addRing, addFleet });
    renderFrame();
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
    pick(clientX, clientY) {
      raycaster.setFromCamera(ndcFromEvent(clientX, clientY), camera);
      const hits = raycaster.intersectObjects(pickables, true);
      return hits.length ? resolveHit(hits[0].object) : null;
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
