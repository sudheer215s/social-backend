#!/usr/bin/env node
/**
 * End-to-end smoke through the API gateway.
 *
 * Prerequisites: compose up + services listening (gateway :3000 by default).
 *
 *   GATEWAY_URL=http://127.0.0.1:3000 node scripts/smoke-e2e.mjs
 *
 * Exit 0 on success, 1 on failure, 2 if gateway unreachable (skip in CI optional).
 */
const base = (process.env.GATEWAY_URL ?? 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);
const suffix = Date.now().toString(36);
const password = 'long-enough-password-1';

let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}
function fail(name, detail) {
  failed += 1;
  console.error(`  ✗ ${name}: ${detail}`);
}

async function req(method, path, { body, token } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return { status: res.status, json };
}

async function main() {
  console.log(`smoke-e2e → ${base}`);

  // Health / reachability
  try {
    const h = await fetch(`${base}/health/live`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!h.ok) {
      console.error(`gateway health not ok: ${h.status}`);
      process.exit(2);
    }
    ok('gateway live');
  } catch (err) {
    console.error(`gateway unreachable: ${err.message ?? err}`);
    console.error('start stack (compose + services) then re-run');
    process.exit(2);
  }

  const userA = {
    username: `sa_${suffix}`,
    email: `sa_${suffix}@example.com`,
    password,
    displayName: 'Smoke A',
  };
  const userB = {
    username: `sb_${suffix}`,
    email: `sb_${suffix}@example.com`,
    password,
    displayName: 'Smoke B',
  };

  // Register A
  let regA = await req('POST', '/v1/auth/register', { body: userA });
  if (regA.status >= 400) {
    fail('register A', JSON.stringify(regA.json));
    process.exit(1);
  }
  const tokenA =
    regA.json?.tokens?.accessToken ?? regA.json?.accessToken ?? null;
  const idA = regA.json?.user?.id;
  if (!tokenA || !idA) {
    fail('register A tokens', JSON.stringify(regA.json));
    process.exit(1);
  }
  ok(`register A (${idA.slice(0, 8)}…)`);

  // Register B
  let regB = await req('POST', '/v1/auth/register', { body: userB });
  if (regB.status >= 400) {
    fail('register B', JSON.stringify(regB.json));
    process.exit(1);
  }
  const tokenB =
    regB.json?.tokens?.accessToken ?? regB.json?.accessToken ?? null;
  const idB = regB.json?.user?.id;
  if (!tokenB || !idB) {
    fail('register B tokens', JSON.stringify(regB.json));
    process.exit(1);
  }
  ok(`register B (${idB.slice(0, 8)}…)`);

  // A creates a post
  const postRes = await req('POST', '/v1/posts', {
    token: tokenA,
    body: { content: `hello smoke ${suffix} #e2e` },
  });
  if (postRes.status >= 400 || !postRes.json?.post?.id) {
    fail('create post', JSON.stringify(postRes.json));
  } else {
    ok(`create post ${postRes.json.post.id.slice(0, 8)}…`);
  }
  const postId = postRes.json?.post?.id;

  // B follows A
  const follow = await req('POST', `/v1/graph/follows/${idA}`, {
    token: tokenB,
  });
  if (follow.status >= 400 && follow.status !== 204) {
    fail('follow', JSON.stringify(follow.json));
  } else {
    ok('B follows A');
  }

  // B likes A's post
  if (postId) {
    const like = await req('POST', `/v1/posts/${postId}/likes`, {
      token: tokenB,
    });
    if (like.status >= 400) {
      fail('like', JSON.stringify(like.json));
    } else {
      ok('B likes post');
    }
  }

  // B home timeline (may be empty until fan-out/rebuild)
  const home = await req('GET', '/v1/timelines/home?limit=10', {
    token: tokenB,
  });
  if (home.status >= 400) {
    fail('home timeline', JSON.stringify(home.json));
  } else {
    ok(
      `home timeline (posts=${Array.isArray(home.json?.posts) ? home.json.posts.length : 0})`,
    );
  }

  // A notifications (follow/like may lag on Kafka)
  const notifs = await req('GET', '/v1/notifications?limit=10', {
    token: tokenA,
  });
  if (notifs.status >= 400) {
    fail('notifications', JSON.stringify(notifs.json));
  } else {
    ok(
      `notifications (items=${Array.isArray(notifs.json?.items) ? notifs.json.items.length : 0})`,
    );
  }

  // Search (may be empty if indexer lag)
  const search = await req(
    'GET',
    `/v1/search?q=${encodeURIComponent(suffix)}&type=post`,
  );
  if (search.status >= 400) {
    fail('search', JSON.stringify(search.json));
  } else {
    ok(
      `search (posts=${Array.isArray(search.json?.posts) ? search.json.posts.length : 0} degraded=${!!search.json?.degraded})`,
    );
  }

  // Realtime ticket
  const ticket = await req('POST', '/v1/realtime/ticket', { token: tokenA });
  if (ticket.status >= 400 || !ticket.json?.ticket) {
    fail('realtime ticket', JSON.stringify(ticket.json));
  } else {
    ok('realtime ticket');
  }

  // Mute then unmute
  const mute = await req('POST', `/v1/graph/mutes/${idB}`, { token: tokenA });
  if (mute.status >= 400 && mute.status !== 204) {
    fail('mute', JSON.stringify(mute.json));
  } else {
    ok('mute');
  }
  const unmute = await req('DELETE', `/v1/graph/mutes/${idB}`, {
    token: tokenA,
  });
  if (unmute.status >= 400 && unmute.status !== 204) {
    fail('unmute', JSON.stringify(unmute.json));
  } else {
    ok('unmute');
  }

  // Deactivate B (grace period; erasure worker later)
  const deact = await req('DELETE', '/v1/users/me', { token: tokenB });
  if (deact.status >= 400 && deact.status !== 204) {
    fail('deactivate B', JSON.stringify(deact.json));
  } else {
    ok('deactivate B');
  }

  console.log('');
  console.log(`done: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
