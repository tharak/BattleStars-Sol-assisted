import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const roots = ["battle", "map"];
const files = roots.flatMap(root => fs.readdirSync(root, { recursive: true })
  .filter(file => file.endsWith(".js"))
  .map(file => path.normalize(path.join(root, file))));
const known = new Set(files);

function localImports(file) {
  const source = fs.readFileSync(file, "utf8");
  return [...source.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)]
    .map(match => match[1])
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
    || file === "battle/battleOrchestrator.js");
  for (const file of protectedFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /(?:panels|render)\.js|\bdocument\.|\bwindow\./, file);
  }
});
