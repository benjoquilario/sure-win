/**
 * Reshape the CMS's Next.js standalone build into the layout Appwrite Sites
 * expects, and leave the result in `.next/standalone` at the repository root.
 *
 * Three things make this necessary:
 *
 * 1. Appwrite starts a site by running `server.js` at the root of the output
 *    directory. In a workspace, Next writes its entry point to
 *    `apps/cms/server.js` inside the standalone tree, because the traced paths
 *    are relative to `outputFileTracingRoot` (the repository root). A build
 *    with no `server.js` where the runtime looks for it does not fail loudly -
 *    it hangs in FINALIZING until the build times out.
 *
 * 2. `next build` never copies `.next/static` or `public/` into the standalone
 *    output; it assumes a CDN serves them. Appwrite serves them from the
 *    bundle, so without this step the site renders with no CSS, no JS and no
 *    images.
 *
 * 3. Next copies `apps/cms/.env` into the bundle when one exists. That file is
 *    a developer's local secrets, including APPWRITE_API_KEY, and the real
 *    values come from the site's environment variables at runtime. It is
 *    removed here so a local file can never ship to production.
 */

import {
  access,
  cp,
  lstat,
  mkdir,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(repoRoot, "apps", "cms");
const nextDir = path.join(appDir, ".next");
const standalone = path.join(nextDir, "standalone");
const outDir = path.join(repoRoot, ".next", "standalone");

/** The app's path inside the standalone tree, mirroring the workspace layout. */
const appInBundle = path.join(outDir, "apps", "cms");

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(standalone))) {
  throw new Error(
    `No standalone build at ${standalone}. ` +
      `Check that apps/cms/next.config.ts still sets output: "standalone".`,
  );
}

// Start from an empty output directory so a stale file from an earlier build
// can never be served.
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// 1. The traced server and its node_modules.
//
// The symlinks must be preserved. Next traces a pnpm workspace into a real
// `node_modules/.pnpm` store plus a thin layer of links into it, and a
// package's transitive dependencies are only resolvable through the link that
// put it there. Dereferencing collapses that layer and Node then fails at
// startup on the first nested dependency (`@swc/helpers`, required by Next's
// own `constants.js`).
//
// Creating a symlink is a privileged operation on Windows unless Developer
// Mode is enabled, so this copy can fail there with EPERM. The deployed build
// runs on Linux and is unaffected; locally we fall back to a dereferenced copy
// so the layout can still be inspected, and say plainly that it will not boot.
let bundleIsRunnable = true;

try {
  await cp(standalone, outDir, { recursive: true, verbatimSymlinks: true });
} catch (error) {
  if (error.code !== "EPERM" || process.platform !== "win32") throw error;

  bundleIsRunnable = false;
  console.warn(
    "warning: this machine cannot create symlinks, so the bundle was copied\n" +
      "         dereferenced. The layout is correct but it will NOT start here.\n" +
      "         Enable Developer Mode on Windows to produce a runnable bundle;\n" +
      "         the Linux build image is unaffected.",
  );
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp(standalone, outDir, { recursive: true, dereference: true });
}

/**
 * Point absolute symlinks back inside the bundle.
 *
 * Some of the links Next writes are absolute paths into the machine's own
 * `node_modules/.pnpm`. That resolves on the machine that built it and nowhere
 * else: on the deployed site the target does not exist, and `require("next")`
 * fails. The store itself was copied above, so the fix is to re-point each
 * link at the copy, relative to the link's own directory.
 */
async function relinkAbsoluteSymlinks(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        const target = await readlink(full);
        if (!path.isAbsolute(target)) return;

        // Where this link pointed, expressed relative to the build root, is
        // where its copy now lives inside the bundle.
        const insideBundle = path.join(outDir, path.relative(repoRoot, target));
        if (path.relative(outDir, insideBundle).startsWith("..")) return;

        await rm(full, { recursive: true, force: true });
        await symlink(
          path.relative(path.dirname(full), insideBundle),
          full,
          "junction",
        );
        return;
      }

      // A real directory may still contain links deeper down.
      if (entry.isDirectory()) await relinkAbsoluteSymlinks(full);
    }),
  );
}

if (bundleIsRunnable) await relinkAbsoluteSymlinks(outDir);

// 2. The assets Next leaves behind.
await cp(path.join(nextDir, "static"), path.join(appInBundle, ".next", "static"), {
  recursive: true,
});

if (await exists(path.join(appDir, "public"))) {
  await cp(path.join(appDir, "public"), path.join(appInBundle, "public"), {
    recursive: true,
  });
}

// 3. The developer's local secrets, if `next build` picked them up.
await rm(path.join(appInBundle, ".env"), { force: true });

// 4. The entry point Appwrite looks for, delegating to where Next put the real
//    one. `server.js` resolves its own paths relative to __dirname, so it has
//    to keep running from `apps/cms`.
await writeFile(
  path.join(outDir, "server.js"),
  `require("./apps/cms/server.js");\n`,
);

console.log(
  `Packed CMS for Appwrite Sites -> ${path.relative(repoRoot, outDir)}` +
    (bundleIsRunnable ? "" : " (layout only - not runnable on this machine)"),
);
