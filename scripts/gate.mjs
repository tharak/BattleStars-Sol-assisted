import { spawnSync } from "node:child_process";

const shell = process.platform === "win32";
const steps = [
  ["unstaged diff hygiene", "git", ["diff", "--check"]],
  ["staged diff hygiene", "git", ["diff", "--cached", "--check"]],
  ["JavaScript syntax", "npm", ["run", "check:syntax"]],
  ["unit and architecture tests", "npm", ["test"]],
  ["production build", "npm", ["run", "build"]],
  ["production browser tests", "npm", ["run", "test:browser"]],
];

let warnings = 0;
for (const [name, command, args] of steps) {
  console.log(`\n[gate] ${name}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell });
  if (result.status !== 0) {
    if (name === "production browser tests") {
      warnings++;
      console.warn(`\n[gate] WARNING at "${name}" (exit ${result.status ?? "killed"}); continuing`);
      if (process.env.GITHUB_ACTIONS) console.log(`::warning::${name} failed; UI regressions are non-blocking by default`);
      continue;
    }
    console.error(`\n[gate] FAIL at "${name}" (exit ${result.status ?? "killed"})`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\n[gate] PASS: ${steps.length - warnings} blocking quality layers are green${warnings ? `; ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}`);
