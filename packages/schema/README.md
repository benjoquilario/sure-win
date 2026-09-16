# @workspace/schema

The single description of the Appwrite database that both apps run against:
every table, column, index, access model, CMS role and permission, plus the
pure helpers built on them (`newRowDefaults`, `ownedRowPermissions`,
`hasActivePremium`, `getTableAccessModel`, ...).

- `apps/cms` (Next.js, `node-appwrite`) reads it to render the dashboard and to
  run `pnpm appwrite:bootstrap`, which creates the tables from it.
- `apps/mobile` (Expo, `react-native-appwrite`) reads it for table IDs, row
  defaults, permission strings and the access rules that decide what a client
  may write.

## Rules

1. **No dependencies, no SDK imports.** `node-appwrite` and
   `react-native-appwrite` export the same class names; a shared module that
   imported either would pull the wrong SDK into the other app. Permissions are
   emitted as wire-format strings, which both SDKs accept. `pnpm check:pure`
   fails the build if this is broken.
2. **Shipped as TypeScript source.** `exports` points at `src/index.ts`; Next
   transpiles it via `transpilePackages`, Metro via the monorepo watch folder.
   There is no build step to forget.
3. **Change the schema here, then run `pnpm appwrite:bootstrap`** from the
   repo root to bring the Appwrite project in line. The mobile app picks up the
   change on its next type-check.
