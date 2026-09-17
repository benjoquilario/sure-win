import path from "node:path";
import type { NextConfig } from "next";

/**
 * The pnpm workspace root. Next infers this from the nearest lockfile, but an
 * inferred root is one stray lockfile away from pointing at `apps/cms`, at
 * which point Turbopack cannot see `packages/` and file tracing leaves the
 * workspace's `node_modules/.pnpm` out of the deployable output.
 */
const workspaceRoot = path.join(__dirname, "..", "..");

const nextConfig: NextConfig = {
  /**
   * Appwrite Sites runs the site from a single traced bundle rather than from
   * an installed `node_modules`, so the server has to carry its dependencies
   * with it. Without this the deployment builds and then hangs in FINALIZING,
   * because there is no `server.js` for the runtime to start.
   */
  output: "standalone",
  /**
   * `node-appwrite` is required at runtime by the server, never bundled into a
   * client chunk; leaving it external keeps it resolvable from the traced
   * `node_modules` instead of being inlined.
   */
  serverExternalPackages: ["node-appwrite"],
  /**
   * `@workspace/schema` ships TypeScript source (no build step), so Next has to
   * compile it as if it were local code.
   */
  transpilePackages: ["@workspace/schema"],
  turbopack: {
    root: workspaceRoot,
  },
  outputFileTracingRoot: workspaceRoot,
  experimental: {
    serverActions: {
      /**
       * Question sheets are uploaded through a Server Action, and the default
       * cap is 1 MB - which a 500-row .xlsx passes without warning. Next
       * rejects the request before any of our code runs, so the importer never
       * gets to explain itself. Kept in step with MAX_UPLOAD_BYTES.
       */
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
