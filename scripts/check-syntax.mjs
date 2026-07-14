import { existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const roots = ["battle", "map", "test", "e2e", "scripts"];
const files = [];
const rootFiles = ["playwright.config.js", "vite.config.js"];

function walk(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory)) {
    const file = path.join(directory, entry);
    if (statSync(file).isDirectory()) walk(file);
    else if (/\.(?:js|mjs)$/.test(entry)) files.push(file);
  }
}

for (const root of roots) walk(root);
for (const file of rootFiles) if (existsSync(file)) files.push(file);
files.sort();

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`[syntax] PASS: ${files.length} JavaScript modules parsed`);
