#!/usr/bin/env node
/**
 * Resolve image digests for prod kustomize and print a ready-to-paste `images:` block.
 *
 * Usage:
 *   REGISTRY=ghcr.io/myorg TAG=1.0.0 node scripts/k8s-pin-digests.mjs
 *   REGISTRY=ghcr.io/myorg TAG=1.0.0 node scripts/k8s-pin-digests.mjs --write
 *
 * Requires: `crane` (https://github.com/google/go-containerregistry) on PATH,
 * or falls back to `docker buildx imagetools inspect` when available.
 *
 * With --write, updates deploy/k8s/overlays/prod/kustomization.yaml images[].digest
 * (keeps newName/newTag; sets digest when resolvable).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const kustomizePath = path.join(
  root,
  'deploy/k8s/overlays/prod/kustomization.yaml',
);

const APPS = [
  { name: 'social-identity', image: 'social-identity' },
  { name: 'social-post', image: 'social-post' },
  { name: 'social-graph', image: 'social-graph' },
  { name: 'social-timeline', image: 'social-timeline' },
  { name: 'social-notification', image: 'social-notification' },
  { name: 'social-search', image: 'social-search' },
  { name: 'social-realtime', image: 'social-realtime' },
  { name: 'social-gateway', image: 'social-gateway' },
];

const registry = (process.env.REGISTRY ?? 'ghcr.io/example').replace(/\/$/, '');
const tag = process.env.TAG ?? '1.0.0';
const write = process.argv.includes('--write');

function resolveDigest(ref) {
  try {
    const out = execFileSync('crane', ['digest', ref], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (out.startsWith('sha256:')) return out;
  } catch {
    // try docker
  }
  try {
    const out = execFileSync(
      'docker',
      ['buildx', 'imagetools', 'inspect', ref, '--format', '{{json .Manifest}}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const m = JSON.parse(out);
    if (m?.digest) return m.digest;
    // multi-arch: top-level may be index
    if (m?.schemaVersion === 2 && m?.mediaType?.includes('index')) {
      // fall through
    }
  } catch {
    // ignore
  }
  try {
    const out = execFileSync(
      'docker',
      ['buildx', 'imagetools', 'inspect', ref],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const match = out.match(/Digest:\s*(sha256:[a-f0-9]+)/i);
    if (match) return match[1];
  } catch {
    // ignore
  }
  return null;
}

const results = [];
for (const app of APPS) {
  const ref = `${registry}/${app.image}:${tag}`;
  const digest = resolveDigest(ref);
  results.push({ ...app, ref, digest });
  if (digest) {
    console.log(`  ✓ ${app.name} → ${digest}`);
  } else {
    console.warn(`  ✗ ${app.name} (${ref}) — digest not resolved`);
  }
}

console.log('\n# Paste into deploy/k8s/overlays/prod/kustomization.yaml under images:\n');
console.log('images:');
for (const r of results) {
  console.log(`  - name: ${r.name}`);
  console.log(`    newName: ${registry}/${r.image}`);
  if (r.digest) {
    console.log(`    digest: ${r.digest}`);
  } else {
    console.log(`    newTag: '${tag}'`);
    console.log(`    # digest: sha256:RESOLVE_ME`);
  }
}

if (write) {
  let yaml = readFileSync(kustomizePath, 'utf8');
  for (const r of results) {
    if (!r.digest) continue;
    // Replace digest comment or existing digest for this image name block
    const nameRe = new RegExp(
      `(- name: ${r.name}\\n(?:    [^\\n]+\\n)*?)(    (?:digest|newTag):[^\\n]+)`,
      'm',
    );
    if (nameRe.test(yaml)) {
      yaml = yaml.replace(nameRe, `$1    digest: ${r.digest}`);
    }
  }
  writeFileSync(kustomizePath, yaml);
  console.log(`\nWrote digests into ${path.relative(root, kustomizePath)}`);
}
