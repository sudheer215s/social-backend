#!/usr/bin/env node
/**
 * F0-T03: prove ESLint catches layer violations and stray fetch.
 * Writes temporary fixtures under real layer paths, runs ESLint, asserts rule hits.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fixtures = [
  {
    rel: 'ui/bad-import.ts',
    source: `import { keys } from '@/data/keys';\nexport const y = keys;\n`,
    rule: 'no-restricted-imports',
  },
  {
    rel: 'features/timeline/bad-fetch.ts',
    source: `export async function load() {\n  return fetch('/v1/timelines/home');\n}\n`,
    rule: 'no-restricted-globals',
  },
  {
    rel: 'features/auth/bad-api-client.ts',
    source: `import { request } from '@/api-client/client';\nexport const r = request;\n`,
    rule: 'no-restricted-imports',
  },
];

/** @param {string} filePath */
async function removePathAndEmptyParents(filePath) {
  await rm(filePath, { force: true });
  let dir = path.dirname(filePath);
  while (dir.startsWith(root) && dir !== root) {
    try {
      await rm(dir, { recursive: false });
    } catch {
      break;
    }
    dir = path.dirname(dir);
  }
}

async function main() {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: path.join(root, 'eslint.config.mjs'),
  });

  let failed = false;

  for (const f of fixtures) {
    const realPath = path.join(root, f.rel);
    await mkdir(path.dirname(realPath), { recursive: true });
    await writeFile(realPath, f.source, 'utf8');

    try {
      const results = await eslint.lintFiles([realPath]);
      const messages = results.flatMap((r) => r.messages);
      const hit = messages.some((m) => m.ruleId === f.rule);
      if (!hit) {
        console.error(
          `FAIL ${f.rel}: expected rule ${f.rule}, got:`,
          messages.map((m) => `${m.ruleId}: ${m.message}`),
        );
        failed = true;
      } else {
        console.log(`ok  ${f.rel} → ${f.rule}`);
      }
    } finally {
      await removePathAndEmptyParents(realPath);
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log('F0-T03 boundary assertions passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
