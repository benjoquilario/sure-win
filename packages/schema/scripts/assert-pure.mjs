#!/usr/bin/env node
/**
 * Refuses any external import in the shared schema.
 *
 * The CMS runs on `node-appwrite`; the app runs on `react-native-appwrite`.
 * Both export identically named classes, and a shared module that imported
 * either would bundle the wrong SDK into the other app - a bug that only shows
 * up at runtime, on one platform, as a mysterious `fetch`/`Platform` failure.
 * So the shared package is not allowed to import anything but itself.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(packageRoot, "src");

const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const problems = [];

for (const file of walk(srcRoot).filter((f) => /\.(m|c)?tsx?$/.test(f))) {
  const source = readFileSync(file, "utf8");

  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2] ?? match[3];

    if (specifier && !specifier.startsWith(".")) {
      problems.push(`${relative(packageRoot, file)}: imports "${specifier}"`);
    }
  }
}

const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
  const names = Object.keys(manifest[field] ?? {});

  if (names.length) {
    problems.push(`package.json: "${field}" must stay empty (found ${names.join(", ")})`);
  }
}

if (problems.length) {
  console.error("@workspace/schema must not depend on anything:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log("@workspace/schema: pure (no external imports, no dependencies)");
