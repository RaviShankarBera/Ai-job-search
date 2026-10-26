# thehub-cli

Zero-runtime-dependency Bun CLI for The Hub. See [SKILL.md](../SKILL.md) for
supported flags, output fields, paging and date limitations, and
[url-reference.md](../url-reference.md) for the verified public endpoints.

From the repository root:

```bash
bun run .agents/skills/thehub-search/cli/src/cli.ts search -q product --country DK --limit 5 --format table
```

For development, from this `cli` directory with Bun on PATH:

```bash
bun install
bun run typecheck
bun test
bun run test:live
```

The last command explicitly opts into a live search and one detail read.
Default tests use reduced fixtures, injected HTTP responses and invalid CLI
arguments without network access. CI discovers this package automatically.
TypeScript and Bun types are development-only dependencies.
