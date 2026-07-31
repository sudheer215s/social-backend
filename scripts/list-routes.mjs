#!/usr/bin/env node
/**
 * Inventory HTTP routes from Nest controller source (static scan).
 *
 *   node scripts/list-routes.mjs
 *   node scripts/list-routes.mjs --json
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appsDir = path.join(root, 'apps');
const asJson = process.argv.includes('--json');

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

  // Method decorators: @Get('path') @Post() etc.
  const re =
    /@(Get|Post|Put|Patch|Delete|Head|Options|All)\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const method = m[1].toUpperCase();
    const sub = (m[2] ?? m[3] ?? '').replace(/^\//, '');
    const full = ['', base, sub].filter(Boolean).join('/').replace(/\/+/g, '/');
    const route = full.startsWith('/') ? full : `/${full}`;
    routes.push({
      method,
      path: route === '/' ? '/' : route.replace(/\/$/, '') || '/',
      file: path.relative(root, file),
    });
  }
  return routes;
}

const files = await walk(appsDir);
const all = [];
for (const f of files) {
  const src = await readFile(f, 'utf8');
  all.push(...parseController(src, f));
}

all.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

if (asJson) {
  console.log(JSON.stringify(all, null, 2));
} else {
  console.log(`# HTTP routes (${all.length})\n`);
  let prev = '';
  for (const r of all) {
    const app = r.file.split(path.sep)[1] ?? '';
    if (app !== prev) {
      console.log(`\n## ${app}`);
      prev = app;
    }
    console.log(`${r.method.padEnd(7)} ${r.path}`);
  }
  console.log('');
}
