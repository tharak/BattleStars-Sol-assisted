import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const roots = ["battle", "map"];
const files = roots.flatMap(root => fs.readdirSync(root, { recursive: true })
  .filter(file => file.endsWith(".js"))
  .map(file => path.normalize(path.join(root, file))));
const known = new Set(files);

function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function localImports(file) {
  const source = fs.readFileSync(file, "utf8");
  const staticImports = [...source.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)]
    .map(match => match[1]);
  const dynamicImports = [...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)]
    .map(match => match[1]);
  return [...staticImports, ...dynamicImports]
    .filter(specifier => specifier.startsWith("."))
    .map(specifier => path.normalize(path.join(path.dirname(file), specifier)))
    .filter(imported => known.has(imported));
}

test("the JavaScript module graph has no circular dependencies", () => {
  const edges = new Map(files.map(file => [file, localImports(file)]));
  const visiting = new Set();
  const visited = new Set();

  function visit(file, trail) {
    if (visiting.has(file)) assert.fail(`circular dependency: ${[...trail, file].join(" -> ")}`);
    if (visited.has(file)) return;
    visiting.add(file);
    for (const dependency of edges.get(file)) visit(dependency, [...trail, file]);
    visiting.delete(file);
    visited.add(file);
  }

  for (const file of files) visit(file, []);
});

test("domain and lifecycle modules do not depend on browser presentation", () => {
  const protectedFiles = files.filter(file => file.startsWith("battle/domain/")
    || file.startsWith("battle/lifecycle/")
    || file === "battle/systems.js"
    || file === "battle/battleOrchestrator.js"
    || file === "battle/core/shipRules.js"
    || file === "map/strategicMovement.js");
  for (const file of protectedFiles) {
    const source = withoutComments(fs.readFileSync(file, "utf8"));
    assert.doesNotMatch(source,
      /(?:panels|render|scene3d)\.js|\b(?:document|window|navigator|localStorage|sessionStorage)\s*[.[]|from\s+["']three(?:\/|["'])/,
      file);
  }
});

test("headless gameplay modules use injected randomness and clocks", () => {
  const deterministicFiles = files.filter(file => file.startsWith("battle/domain/")
    || file.startsWith("battle/lifecycle/")
    || file === "battle/systems.js"
    || file === "battle/core/shipRules.js"
    || file === "battle/formations.js"
    || file === "battle/hexmath.js"
    || file === "map/strategicMovement.js");
  for (const file of deterministicFiles) {
    const source = withoutComments(fs.readFileSync(file, "utf8"));
    assert.doesNotMatch(source, /\b(?:Math\.random|Date\.now|performance\.now)\b/, file);
  }
});

test("Three.js stays isolated behind the strategic scene adapter", () => {
  for (const file of files) {
    if (file === path.normalize("map/scene3d.js")) continue;
    const source = withoutComments(fs.readFileSync(file, "utf8"));
    assert.doesNotMatch(source, /from\s+["']three(?:\/|["'])/, file);
  }
});
