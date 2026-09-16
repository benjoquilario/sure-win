# Deploying

The two apps deploy independently, from the same repository, and neither build
touches the other's files. What they share is `packages/schema` and the root
`pnpm-lock.yaml`, which is why both builds start from the repository root.

## CMS → Appwrite Sites

Appwrite Sites has full Next.js support (SSR included, no adapter). In the
console, **Sites → Create site → Connect Git**, then:

| Setting           | Value                                                                  |
| ----------------- | ---------------------------------------------------------------------- |
| Framework         | Next.js (auto-detected)                                                |
| Root directory    | `./` (the repository root - **not** `apps/cms`)                        |
| Install command   | `corepack enable && pnpm install --frozen-lockfile --filter @workspace/cms...` |
| Build command     | `pnpm turbo run build --filter=@workspace/cms`                         |
| Output directory  | `./apps/cms/.next`                                                     |
| Production branch | `main`                                                                 |
| Path filter       | `apps/cms/**`, `packages/**`, `pnpm-lock.yaml` (optional; skips mobile-only commits) |

Why the root directory is `./`: the CMS depends on `packages/schema` and on the
workspace lockfile, both of which live above `apps/cms`. Pointing Appwrite at
the subfolder would hide them from the install step.

If `corepack` is unavailable in the build image, use
`npm install -g pnpm@11 && pnpm install --frozen-lockfile --filter @workspace/cms...`
as the install command instead. The `...` suffix installs the CMS *and* its
workspace dependencies (the schema package) and nothing else - the Expo/React
Native tree is never downloaded for a CMS build.

Environment variables (Sites → Settings → Environment variables), all of
which `next build` needs at build time, not just at runtime:

```
NEXT_PUBLIC_APPWRITE_ENDPOINT
NEXT_PUBLIC_APPWRITE_PROJECT_ID
NEXT_PUBLIC_APPWRITE_PROJECT_NAME
NEXT_PUBLIC_APP_URL              ← the site's own URL, e.g. https://cms.example.com
APPWRITE_API_KEY                 ← mark as secret
APPWRITE_DATABASE_ID
APPWRITE_ASSETS_BUCKET_ID
APPWRITE_SESSION_COOKIE
APPWRITE_CMS_SUPER_ADMIN_EMAILS
APPWRITE_CMS_ADMIN_EMAILS
GOOGLE_PLAY_*                    ← see apps/cms/.env.billing.example
```

After the first deploy, set `EXPO_PUBLIC_CMS_BASE_URL` in the mobile app to
the site's URL: that is how the app turns `/api/assets/<fileId>` paths into
loadable images.

`next.config.ts` pins `turbopack.root` and `outputFileTracingRoot` to the
repository root so the traced server bundle includes the workspace
`node_modules/.pnpm` store and `packages/schema`; do not remove those.

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

**Requirement: one git repository at the root.** EAS uploads the git working
tree it is standing in. Today `apps/mobile` still has its own `.git`, so from
inside it EAS would upload only `apps/mobile` - without `packages/schema` or
the root lockfile - and the build would fail on `@workspace/schema`. Finish the
merge in `docs/monorepo-migration.md` (either option) before the first EAS
build from this layout.

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
