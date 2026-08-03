# Committed OpenAPI surface

`openapi.json` is the contract source for the web client (`pnpm --filter @social/web api:types`).

Regenerate after controller route changes:

```bash
mkdir -p openapi
pnpm openapi:export -- --out=openapi/openapi.json
pnpm --filter @social/web api:types
```

Schemas are currently placeholders from the static Nest scan (`scripts/export-openapi.mjs`).
When DTO export lands, re-run both commands and commit the diff — CI will eventually gate on drift.
