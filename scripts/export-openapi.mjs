#!/usr/bin/env node
/**
 * Generate a minimal OpenAPI 3.0 document from Nest controller routes.
 *
 *   node scripts/export-openapi.mjs > openapi.json
 *   pnpm openapi:export
 *
 * This is a static scan — not runtime reflection. Paths and methods only;
 * request/response schemas are placeholders until full DTO export lands.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appsDir = path.join(root, 'apps');
const outArg = process.argv.find((a) => a.startsWith('--out='));
const outPath = outArg
  ? path.resolve(root, outArg.slice('--out='.length))
  : null;

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      out.push(...(await walk(p)));
    } else if (e.isFile() && e.name.endsWith('.controller.ts')) {
      out.push(p);
    }
  }
  return out;
}

function parseController(src, file) {
  const routes = [];
  const ctrlMatch = src.match(/@Controller\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/);
  const base = (ctrlMatch?.[1] ?? ctrlMatch?.[2] ?? '').replace(/\/$/, '');
  const app = path.relative(root, file).split(path.sep)[1] ?? 'unknown';

  const re =
    /@(Get|Post|Put|Patch|Delete|Head|Options|All)\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const method = m[1].toLowerCase();
    const sub = (m[2] ?? m[3] ?? '').replace(/^\//, '');
    const full = ['', base, sub].filter(Boolean).join('/').replace(/\/+/g, '/');
    let route = full.startsWith('/') ? full : `/${full}`;
    if (route !== '/' && route.endsWith('/')) route = route.slice(0, -1);
    // Nest :param → OpenAPI {param}
    const oasPath = route.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    routes.push({ method, path: oasPath, app, file: path.relative(root, file) });
  }
  return routes;
}

function pathParams(oasPath) {
  const params = [];
  const re = /\{([A-Za-z0-9_]+)\}/g;
  let m;
  while ((m = re.exec(oasPath)) !== null) {
    params.push({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
  }
  return params;
}

const files = await walk(appsDir);
const all = [];
for (const f of files) {
  const src = await readFile(f, 'utf8');
  all.push(...parseController(src, f));
}

// Prefer api-gateway surface for public API; still tag all apps.
const paths = {};
for (const r of all) {
  if (!paths[r.path]) paths[r.path] = {};
  // later duplicate method on same path: last wins (gateway + service often share)
  paths[r.path][r.method] = {
    tags: [r.app],
    summary: `${r.method.toUpperCase()} ${r.path}`,
    operationId: `${r.app}_${r.method}_${r.path.replace(/[^a-zA-Z0-9]+/g, '_')}`,
    parameters: pathParams(r.path),
    responses: {
      '200': { description: 'Success (schema TBD)' },
      '204': { description: 'No content' },
      '400': { description: 'Bad request' },
      '401': { description: 'Unauthorized' },
      '404': { description: 'Not found' },
      '503': { description: 'Unavailable' },
    },
    'x-source-file': r.file,
  };
  if (['post', 'put', 'patch'].includes(r.method)) {
    paths[r.path][r.method].requestBody = {
      required: false,
      content: {
        'application/json': {
          schema: { type: 'object', additionalProperties: true },
        },
      },
    };
  }
}

const doc = {
  openapi: '3.0.3',
  info: {
    title: 'Social Backend API',
    version: '0.1.0',
    description:
      'Generated from Nest controller static scan. Schemas are placeholders.',
  },
  servers: [
    { url: 'http://127.0.0.1:3000', description: 'API gateway (local)' },
  ],
  tags: [...new Set(all.map((r) => r.app))].sort().map((name) => ({ name })),
  paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  security: [{ bearerAuth: [] }],
};

const json = JSON.stringify(doc, null, 2);
if (outPath) {
  await writeFile(outPath, json + '\n', 'utf8');
  console.error(`wrote ${outPath} (${Object.keys(paths).length} paths)`);
} else {
  process.stdout.write(json + '\n');
}
