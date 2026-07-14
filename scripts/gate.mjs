import { spawnSync } from "node:child_process";

const shell = process.platform === "win32";
const steps = [
  ["unstaged diff hygiene", "git", ["diff", "--check"]],
  ["staged diff hygiene", "git", ["diff", "--cached", "--check"]],
  ["JavaScript syntax", "npm", ["run", "check:syntax"]],
  ["unit and architecture tests", "npm", ["test"]],
  ["production browser tests", "npm", ["run", "test:browser"]],
];

for (const [name, command, args] of steps) {
  console.log(`\n[gate] ${name}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell });
  if (result.status !== 0) {
    console.error(`\n[gate] FAIL at "${name}" (exit ${result.status ?? "killed"})`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\n[gate] PASS: all ${steps.length} quality layers are green`);
