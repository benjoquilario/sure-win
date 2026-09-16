#!/usr/bin/env node
/**
 * Keeps the two Appwrite SDKs on their own side of the fence.
 *
 *   apps/cms      -> node-appwrite only   (server side, API key / session)
 *   apps/mobile   -> react-native-appwrite only (client side, user session)
 *   packages/*    -> neither
 *
 * Both SDKs share a backend and an API surface, which is exactly why mixing
 * them is easy and wrong: `node-appwrite` in the app bundle drags Node built-ins
 * into Metro, and `react-native-appwrite` on the server has no `Platform`. The
 * check reads package.json declarations and the import statements in source.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SERVER_SDKS = ["node-appwrite"];
const CLIENT_SDKS = ["react-native-appwrite", "appwrite"];

const RULES = [
  { dir: "apps/cms", forbidden: CLIENT_SDKS, label: "the CMS (server side)" },
  { dir: "apps/mobile", forbidden: SERVER_SDKS, label: "the mobile app (client side)" },
];

const SKIP_DIRS = new Set(["node_modules", ".next", ".expo", ".turbo", "android", "ios", "out", "dist"]);
const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const problems = [];

for (const pkgDir of readdirSync(join(root, "packages"))) {
  RULES.push({
    dir: `packages/${pkgDir}`,
    forbidden: [...SERVER_SDKS, ...CLIENT_SDKS],
    label: `shared package ${pkgDir}`,
  });
}

for (const rule of RULES) {
  const dir = join(root, rule.dir);
  const manifestPath = join(dir, "package.json");

  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        if (rule.forbidden.includes(name)) {
          problems.push(`${rule.dir}/package.json declares "${name}" - not allowed in ${rule.label}`);
        }
      }
    }
  }

  for (const file of walk(dir).filter((f) => /\.(m|c)?[jt]sx?$/.test(f))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier || specifier.startsWith(".")) continue;
      if (rule.forbidden.includes(packageName(specifier))) {
        problems.push(`${relative(root, file)} imports "${specifier}" - not allowed in ${rule.label}`);
      }
    }
  }
}

if (problems.length) {
  console.error("Appwrite SDK boundary violations:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log("SDK boundaries hold: cms=node-appwrite, mobile=react-native-appwrite, packages=none");
