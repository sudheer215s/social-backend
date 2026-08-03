#!/usr/bin/env node
/**
 * Validate deploy-oriented env / ConfigMap keys for production readiness.
 *
 * Usage:
 *   node scripts/verify-deploy-config.mjs
 *   node scripts/verify-deploy-config.mjs --env=.env
 *   node scripts/verify-deploy-config.mjs --strict   # fail on warnings
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envArg = process.argv.find((a) => a.startsWith('--env='));
const envPath = envArg
  ? path.resolve(root, envArg.slice('--env='.length))
  : path.join(root, '.env');
const strict = process.argv.includes('--strict');

function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const env = { ...loadEnvFile(envPath), ...process.env };

const requiredProd = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_ISSUER',
  'JWT_AUDIENCE',
  'IDENTITY_JWKS_URL',
  'IDENTITY_BASE_URL',
  'POST_BASE_URL',
  'GRAPH_BASE_URL',
  'TIMELINE_BASE_URL',
  'NOTIFICATION_BASE_URL',
  'SEARCH_BASE_URL',
  'REALTIME_BASE_URL',
  'REALTIME_SERVICE_TOKEN',
];

const recommendedProd = [
  'TRUSTED_PROXIES',
  'CORS_ORIGINS',
  'ENFORCE_EMAIL_VERIFIED',
  'KAFKA_BROKERS',
  'ELASTICSEARCH_URL',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'APP_VERSION',
  'JSON_BODY_LIMIT',
  'UPSTREAM_TIMEOUT_MS',
];

const errors = [];
const warnings = [];

for (const k of requiredProd) {
  if (!env[k] || String(env[k]).trim() === '') {
    errors.push(`missing required: ${k}`);
  }
}

for (const k of recommendedProd) {
  if (!env[k] || String(env[k]).trim() === '') {
    warnings.push(`recommended unset: ${k}`);
  }
}

if (env.NODE_ENV === 'production') {
  if (!env.CORS_ORIGINS || env.CORS_ORIGINS === '*') {
    errors.push('production CORS_ORIGINS must be an explicit origin list');
  }
  if (env.ENFORCE_EMAIL_VERIFIED === '0') {
    warnings.push('ENFORCE_EMAIL_VERIFIED=0 in production');
  }
  if (
    env.JWT_ISSUER?.includes('example.com') ||
    env.CORS_ORIGINS?.includes('example.com')
  ) {
    warnings.push('example.com still present in JWT_ISSUER or CORS_ORIGINS');
  }
}

// ConfigMap static check
const cmPath = path.join(root, 'deploy/k8s/configmap.yaml');
if (existsSync(cmPath)) {
  const cm = readFileSync(cmPath, 'utf8');
  for (const k of [
    'TRUSTED_PROXIES',
    'CORS_ORIGINS',
    'ENFORCE_EMAIL_VERIFIED',
  ]) {
    if (!cm.includes(`${k}:`)) {
      warnings.push(`configmap.yaml missing ${k}`);
    }
  }
  if (cm.includes('example.com')) {
    warnings.push(
      'deploy/k8s/configmap.yaml still has example.com hosts — replace for real prod',
    );
  }
}

console.log('Deploy config check');
console.log(`  env file: ${existsSync(envPath) ? envPath : '(none — process env only)'}`);
console.log(`  NODE_ENV: ${env.NODE_ENV ?? '(unset)'}`);
if (errors.length === 0) {
  console.log('  required: OK');
} else {
  for (const e of errors) console.error(`  ✗ ${e}`);
}
for (const w of warnings) console.warn(`  ⚠ ${w}`);

if (errors.length > 0 || (strict && warnings.length > 0)) {
  process.exit(1);
}
console.log('  result: pass');
