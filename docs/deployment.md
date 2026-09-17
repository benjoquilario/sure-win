# Deploying

The two apps deploy independently, from the same repository, and neither build
touches the other's files. What they share is `packages/schema` and the root
`pnpm-lock.yaml`, which is why both builds start from the repository root.

## CMS → Appwrite Sites

Appwrite Sites builds Next.js without an adapter, but a workspace needs three
things set explicitly. In the console, **Sites → Create site → Connect Git**:

| Setting           | Value                                                    |
| ----------------- | -------------------------------------------------------- |
| Framework         | Next.js                                                  |
| Root directory    | `./` (the repository root - **not** `./apps` or `./apps/cms`) |
| Install command   | `corepack enable && pnpm install --frozen-lockfile --filter @workspace/cms...` |
| Build command     | `pnpm build:cms:appwrite`                                |
| Output directory  | `./.next/standalone`                                     |
| Rendering         | Server side rendering                                    |
| Production branch | `main`                                                   |

**Root directory must be `./`.** It is an upload boundary, not a `cd`: only
that subtree is copied to the build executor. Point it at `./apps/cms` and the
build never sees `pnpm-workspace.yaml`, the lockfile or `packages/schema`, so
the `workspace:*` dependency cannot resolve.

**The install command must name pnpm.** The Next.js preset defaults to
`npm install`, and npm cannot parse the `catalog:` protocol this workspace uses
for `react`, `react-dom` and `typescript`. A default install fails with
`Unsupported URL Type "catalog:"`. If `corepack` is unavailable in the build
image, use `npm install -g pnpm@11 && pnpm install --frozen-lockfile --filter
@workspace/cms...` instead. The `...` suffix installs the CMS *and* its
workspace dependencies and nothing else, so the Expo tree is never downloaded.

**The build command is not `next build`.** `pnpm build:cms:appwrite` runs the
Turbo build and then `scripts/pack-cms-for-appwrite.mjs`, which reshapes the
output. Appwrite starts a site by running `server.js` at the root of the output
directory, but in a workspace Next writes its entry point to
`apps/cms/server.js` inside the standalone tree (the traced paths are relative
to `outputFileTracingRoot`). A build with no `server.js` where the runtime
looks for it does not fail loudly - it hangs in FINALIZING until the build
times out. The script also copies in `.next/static` and `public/`, which
`next build` deliberately leaves out of standalone output, and deletes the
local `.env` if one was picked up.

Do not remove `output: "standalone"`, `outputFileTracingRoot` or
`transpilePackages` from `apps/cms/next.config.ts`; each one is load-bearing
for this pipeline.

Environment variables (Sites → Settings → Environment variables). Next inlines
`NEXT_PUBLIC_*` at build time, so a change to any of them needs a redeploy, not
just a restart:

```
NEXT_PUBLIC_APPWRITE_ENDPOINT
NEXT_PUBLIC_APPWRITE_PROJECT_ID
NEXT_PUBLIC_APPWRITE_PROJECT_NAME
NEXT_PUBLIC_APP_URL              ← the site's own URL, e.g. https://sure-win.appwrite.network
APPWRITE_API_KEY                 ← mark as secret
APPWRITE_DATABASE_ID
APPWRITE_ASSETS_BUCKET_ID
APPWRITE_SESSION_COOKIE
APPWRITE_CMS_SUPER_ADMIN_EMAILS
APPWRITE_CMS_ADMIN_EMAILS
GOOGLE_PLAY_*                    ← see apps/cms/.env.billing.example
```

`NEXT_PUBLIC_APP_URL` must match the deployed domain exactly. OAuth builds its
success and failure redirects from it (`app/api/auth/oauth/route.ts`), and
Appwrite rejects a redirect to an unregistered origin - add the domain under
**Auth → Settings → Hostnames** too, or sign-in fails with `oauth_redirect_invalid`.

Do not define your own variables prefixed `APPWRITE_SITE_`; Appwrite injects
that namespace and its values win.

After the first deploy, set `EXPO_PUBLIC_CMS_BASE_URL` in the mobile app to
the site's URL: that is how the app turns `/api/assets/<fileId>` paths into
loadable images.

## Mobile → EAS Build / Expo

Nothing about EAS changed except where you stand when you run it:

```bash
cd apps/mobile
eas build --platform android --profile production
eas update --branch production --message "..."
```

EAS CLI finds the workspace root from `pnpm-lock.yaml`, uploads the whole
repository minus what `.easignore` (at the repository root) excludes, runs
`pnpm install` at the root (pnpm version from the `packageManager` field), and
builds inside `apps/mobile`. `eas.json`, credentials and `app.json` stay in
`apps/mobile`.

**One git repository at the root.** EAS uploads the git working tree it is
standing in, so a nested `.git` under `apps/mobile` would upload only that
folder - without `packages/schema` or the root lockfile - and the build would
fail on `@workspace/schema`. Both apps were flattened into the root repository
(see `docs/monorepo-migration.md`), so this is satisfied; do not reintroduce a
nested repository under `apps/`.

Environment variables for the app are `EXPO_PUBLIC_*` and are baked into the
JS bundle at build time. Keep them in `eas.json` `build.<profile>.env`, or in
EAS environment variables (`eas env:create`), never in a committed `.env`.

Two things strict pnpm required, both already done and both things EAS would
otherwise hit on its first prebuild:

- Local config plugins import from `expo/config-plugins` (re-exported by the
  `expo` package) rather than the transitive `@expo/config-plugins`.
- `expo-file-system` and `react-native-css-interop` are declared in
  `apps/mobile/package.json` because app code and NativeWind's JSX runtime
  import them directly.

If EAS ever reports a module that resolves locally but not on the build
server, the fallback documented by Expo is to switch pnpm to the hoisted
linker: add `nodeLinker: hoisted` to `pnpm-workspace.yaml`. Do that only as a
last resort - it weakens the SDK isolation described in the README.

## Appwrite Functions

Unchanged: each function under `functions/<name>` is deployed on its own with
entrypoint `main.js`. If deploying from Git, set the function's root directory
to `functions/<name>`.

## Order of operations for a schema change

1. Edit `packages/schema/src/schema.ts`; `pnpm typecheck`.
2. `pnpm appwrite:bootstrap` - the database must have the new columns before
   any client that writes them ships.
3. Deploy the CMS (Sites redeploys on push to `main`).
4. Ship the app: `eas update` if only JS changed, `eas build` if native
   modules changed.

Additive changes (new optional columns, new tables) are safe in this order.
For a removed or renamed column, the app version that stops writing it must
be live everywhere before `--prune` runs; older installed app versions keep
writing to the old column until they update.
