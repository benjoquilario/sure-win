# Social Work Reviewer monorepo

pnpm workspaces + Turborepo. Read `README.md` first.

- `apps/cms` - Next.js 16 dashboard. Server side only: `node-appwrite`. Has its own `AGENTS.md` about this Next version.
- `apps/mobile` - Expo 57 app. Client side only: `react-native-appwrite`. No semicolons (Prettier config in its package.json).
- `packages/schema` - `@workspace/schema`. The single source of truth for tables, columns, indexes, access models, roles and permissions. **Never add an import or a dependency to it.**
- `functions/*` - Appwrite Functions, standalone CommonJS; not consumers of the workspace packages.
- `docs/schema/MOBILE-SCHEMA-NOTES-v6.md` is the current mobile ↔ backend contract.

Rules that the tooling enforces (`pnpm check`): no Appwrite SDK in `packages/*`, no `react-native-appwrite` in `apps/cms`, no `node-appwrite` in `apps/mobile`. Keep it that way.

Install and run from the repo root (`pnpm install`, `pnpm dev:cms`, `pnpm dev:mobile`). Schema changes: edit `packages/schema/src/schema.ts`, `pnpm typecheck`, then `pnpm appwrite:bootstrap`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
