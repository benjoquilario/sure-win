# Social Work Reviewer

One Appwrite backend, two front ends, one schema.

```
sure-win/
├── apps/
│   ├── cms/        Next.js 16 dashboard        → node-appwrite (server SDK, API key + session)
│   └── mobile/     Expo 57 / React Native app  → react-native-appwrite (client SDK, user session)
├── packages/
│   ├── schema/             @workspace/schema: every table, column, index, access model,
│   │                       role and permission. Zero dependencies. Both apps import it.
│   └── typescript-config/  Shared tsconfig bases.
├── functions/      Appwrite Functions (standalone CommonJS, deployed from the console)
├── docs/
│   ├── schema/     Schema notes and the mobile ↔ backend contract
│   └── billing/    Google Play billing design notes
└── scripts/        Repo-level checks (SDK boundary guard)
```

Package manager is **pnpm** (workspaces, strict/isolated `node_modules`) and the
task runner is **Turborepo**.

## Everyday commands

| Command                    | What it does                                                   |
| -------------------------- | -------------------------------------------------------------- |
| `pnpm install`             | Install everything, once, from the repo root                   |
| `pnpm dev:cms`             | Next dev server for the dashboard                              |
| `pnpm dev:mobile`          | Expo dev server for the app                                    |
| `pnpm typecheck`           | `tsc --noEmit` in every workspace, schema first                 |
| `pnpm lint`                | ESLint in both apps + the schema purity check                  |
| `pnpm check`               | Boundaries + purity + typecheck + lint                          |
| `pnpm build`               | `next build` for the CMS (Expo builds go through EAS)          |
| `pnpm appwrite:bootstrap`  | Create missing tables/columns/indexes from `@workspace/schema` |
| `pnpm appwrite:inspect`    | Read-only diff of the live database against the schema         |

Run anything else in one workspace with `pnpm --filter @workspace/cms <script>`
or `pnpm --filter @workspace/mobile <script>`. EAS builds run from
`apps/mobile` as before (`cd apps/mobile && eas build ...`); EAS detects the
pnpm workspace from the root lockfile.

## Why the two apps cannot step on each other

Both apps talk to the same Appwrite project, and the two SDKs export the same
class names, so the guard rails are structural rather than by convention:

1. **`@workspace/schema` has no dependencies and imports nothing.** It ships
   TypeScript source, emits permissions as wire-format strings, and is
   type-checked with `lib: ["ES2022"]` and `types: []` so it cannot even see a
   Node or DOM global. `pnpm --filter @workspace/schema check:pure` fails on
   any external import.
2. **Isolated `node_modules`.** With pnpm's default linker, `apps/cms` can only
   resolve `node-appwrite` and `apps/mobile` can only resolve
   `react-native-appwrite`. An accidental cross-import is a module-not-found
   error at type-check time, not a runtime surprise on one platform.
3. **`scripts/check-sdk-boundaries.mjs`** reads every `package.json` and every
   import statement under `apps/` and `packages/` and fails if a server SDK
   shows up on the client side or vice versa. It runs as part of `pnpm check`.
4. **Dependency overrides live in `pnpm-workspace.yaml`** (pnpm 11 ignores a
   `pnpm.overrides` block in `package.json`). The one that matters:
   `expo-file-system` is forced to the SDK 57 version because
   `react-native-appwrite` would otherwise install a second, older copy of that
   native module.
5. **One React.** `react`, `react-dom`, `@types/react`, `typescript` and
   `eslint` are pinned once in the `catalog:` of `pnpm-workspace.yaml`. Expo 57
   requires React 19.2.3 exactly, so the CMS follows it.

## Changing the schema

1. Edit `packages/schema/src/schema.ts`.
2. `pnpm typecheck` - both apps recompile against the new shape; a renamed
   table or a removed column is a compile error in every call site.
3. `pnpm appwrite:bootstrap` (from the root) to create what is missing in
   Appwrite. Pruning is opt-in and two-step; see the header of
   `apps/cms/scripts/bootstrap-appwrite.ts`.

## Deploying

The CMS deploys to **Appwrite Sites** and the app through **EAS**; each build
installs only its own slice of the workspace. Exact console settings, env
variables and the order of operations for a schema change are in
`docs/deployment.md`.

## Environment

Each app keeps its own `.env` with its own prefix (`NEXT_PUBLIC_*` /
`APPWRITE_*` for the CMS, `EXPO_PUBLIC_*` for the app). Copy the matching
`.env.example` to get started. Turbo includes those variables in its cache
keys, so a changed key does not serve a stale build.

## Appwrite Functions

`functions/*` are deployed from the Appwrite console with entrypoint `main.js`
and install their own `node-appwrite` at build time. They are workspace
members so a root `pnpm install` gives them their dependencies locally, but
they do not import `@workspace/schema` - Appwrite bundles a function directory
in isolation, so table IDs there still come from function environment
variables (with the schema's IDs as defaults).
