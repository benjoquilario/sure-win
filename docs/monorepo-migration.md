# Monorepo migration notes

`apps/cms` and `apps/mobile` were moved here from two standalone repositories
(`benjoquilario/cms-social-work-reviewer`, branch `main`, and
`benjoquilario/social-work-reviewer`, branch `master`). Their `.git`
directories were left in place so nothing was lost; the root has no repository
yet. Pick one of the two options below.

## Option A - keep both histories (recommended)

From the repo root, with both nested working trees committed and clean:

```bash
git init -b main
# Temporarily hide the nested repos so root git treats the folders as plain files
mv apps/cms/.git   /tmp/cms.git
mv apps/mobile/.git /tmp/mobile.git

# Import each history under its new prefix
git fetch /tmp/cms.git main
git subtree add --prefix=apps/cms   FETCH_HEAD -m "chore: import CMS history into apps/cms"
git fetch /tmp/mobile.git master
git subtree add --prefix=apps/mobile FETCH_HEAD -m "chore: import mobile history into apps/mobile"

# Everything the restructure added or moved (root config, packages/, functions/, docs/)
git add -A
git commit -m "chore: restructure into a pnpm + turborepo monorepo with a shared Appwrite schema"
```

`git log --follow apps/mobile/lib/db/rows.ts` then shows the original commits.
Delete `/tmp/cms.git` and `/tmp/mobile.git` once you are happy.

## Option B - start fresh

```bash
rm -rf apps/cms/.git apps/mobile/.git
git init -b main
git add -A
git commit -m "chore: monorepo"
```

The old repositories on GitHub keep the history either way.

## Things that moved

| Before                                            | After                                   |
| ------------------------------------------------- | --------------------------------------- |
| `cms-social-work-reviewer/`                       | `apps/cms/`                             |
| `social-work-reviewer/`                           | `apps/mobile/`                          |
| `social-work-reviewer/functions/*`                | `functions/*`                           |
| `cms/lib/appwrite/schema.ts` (source of truth)    | `packages/schema/src/schema.ts`         |
| `mobile/lib/schema.ts` (stale hand-copy, deleted) | imports `@workspace/schema`             |
| `*/MOBILE-SCHEMA-NOTES*.md`, `MOBILE-API-NOTES.md`, `BACKEND-REQUESTS.md` | `docs/schema/` |
| `*/google-play-billing*.md`, `*/billing-api-reply*.md` | `docs/billing/`                    |
| `cms/pnpm-workspace.yaml` build-script settings   | root `pnpm-workspace.yaml`              |
| `mobile/package.json` `overrides`                 | root `pnpm-workspace.yaml` → `overrides` |

Where the CMS and mobile copies of a note differed, the CMS copy was kept (it
was the newer one in every case); the mobile copy is still in the mobile repo's
history.

## Things to re-point outside the repo

- **Appwrite Functions**: if any function is deployed from Git, its root
  directory is now `functions/<name>` instead of `functions/<name>` inside the
  mobile repo. Entrypoint is still `main.js`.
- **Vercel / hosting for the CMS**: set the project root directory to
  `apps/cms`. Vercel detects the pnpm workspace from the root lockfile.
- **EAS**: run `eas build` from `apps/mobile`; nothing else changes.
