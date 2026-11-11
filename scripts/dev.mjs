import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = new Set();
let stopping = false;

function run(args, cwd = root) {
  const child = spawn(process.execPath, args, { cwd, stdio: "inherit" });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

function done(child) {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  if (code !== undefined) process.exit(code);
}

process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));

const tsc = path.join(root, "node_modules/typescript/bin/tsc");
for (const project of ["packages/docs-api/tsconfig.json", "packages/docs-mcp/tsconfig.json"]) {
  const code = await done(run([tsc, "-p", project]));
  if (code !== 0) stop(code);
}

const api = run(["packages/docs-api/dist/cli.js"]);
const web = run(
  [path.join(root, "node_modules/@rspress/core/bin/rspress.js"), "dev"],
  path.join(root, "packages/docs-web"),
);

api.on("exit", (code) => stop(code ?? 1));
web.on("exit", (code) => stop(code ?? 0));
