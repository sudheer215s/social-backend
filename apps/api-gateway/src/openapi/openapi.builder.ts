/**
 * Static OpenAPI document for the public gateway surface.
 * Kept in-code so Docker images (dist-only) still serve a useful spec.
 * Full monorepo scan remains available via `pnpm openapi:export`.
 */
export function buildGatewayOpenApi(): Record<string, unknown> {
  const bearer = [{ bearerAuth: [] }];
  const paths: Record<string, unknown> = {
    '/v1/auth/register': {
      post: {
        tags: ['auth'],
        summary: 'Register',
        security: [],
        responses: {
          '201': { description: 'Created' },
          '409': { description: 'Conflict' },
        },
      },
    },
    '/v1/auth/login': {
      post: {
        tags: ['auth'],
        summary: 'Login',
        security: [],
        responses: {
          '200': { description: 'OK' },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/v1/auth/refresh': {
      post: {
        tags: ['auth'],
        summary: 'Refresh tokens (body or rt cookie)',
        security: [],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/v1/auth/logout': {
      post: {
        tags: ['auth'],
        summary: 'Logout current session',
        security: [],
        responses: { '204': { description: 'No content' } },
      },
    },
    '/v1/auth/logout-all': {
      post: {
        tags: ['auth'],
        summary: 'Revoke all sessions for the caller',
        security: bearer,
        responses: { '204': { description: 'No content' } },
      },
    },
    '/v1/posts': {
      get: {
        tags: ['posts'],
        summary: 'List posts by author (cursor)',
        security: [],
        parameters: [
          {
            name: 'authorId',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'OK' } },
      },
      post: {
        tags: ['posts'],
        summary: 'Create post (requires Idempotency-Key)',
        security: bearer,
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '201': { description: 'Created' },
          '400': { description: 'Missing Idempotency-Key' },
          '403': { description: 'Email not verified' },
        },
      },
    },
    '/v1/timelines/home': {
      get: {
        tags: ['timeline'],
        summary: 'Home timeline',
        security: bearer,
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/v1/notifications': {
      get: {
        tags: ['notifications'],
        summary: 'List notifications',
        security: bearer,
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/v1/search': {
      get: {
        tags: ['search'],
        summary: 'Search posts and users',
        security: [],
        parameters: [
          {
            name: 'q',
            in: 'query',
            required: true,
            schema: { type: 'string' },
          },
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/v1/realtime/ticket': {
      post: {
        tags: ['realtime'],
        summary: 'Issue realtime ticket (~20/min per user)',
        security: bearer,
        responses: {
          '200': { description: 'OK' },
          '429': { description: 'Rate limited' },
        },
      },
    },
    '/v1/users/me/export': {
      get: {
        tags: ['users'],
        summary: 'Export account data (sync JSON package)',
        security: bearer,
        responses: { '200': { description: 'OK' } },
      },
    },
    '/v1/reports': {
      post: {
        tags: ['moderation'],
        summary: 'File abuse report (user or post)',
        security: bearer,
        responses: {
          '201': { description: 'Created' },
          '400': { description: 'Duplicate / invalid' },
          '429': { description: 'Rate limited' },
        },
      },
    },
    '/v1/admin/reports': {
      get: {
        tags: ['moderation'],
        summary: 'List abuse reports (admin; ADMIN_USER_IDS)',
        security: bearer,
        responses: {
          '200': { description: 'OK' },
          '403': { description: 'Not admin' },
        },
      },
    },
    '/v1/admin/reports/{id}': {
      patch: {
        tags: ['moderation'],
        summary: 'Update report status (admin)',
        security: bearer,
        responses: {
          '200': { description: 'OK' },
          '403': { description: 'Not admin' },
          '404': { description: 'Not found' },
        },
      },
    },
    '/v1/version': {
      get: {
        tags: ['ops'],
        summary: 'Build / runtime version',
        security: [],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/health/live': {
      get: {
        tags: ['ops'],
        summary: 'Liveness',
        security: [],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/health/ready': {
      get: {
        tags: ['ops'],
        summary: 'Readiness',
        security: [],
        responses: {
          '200': { description: 'OK' },
          '503': { description: 'Not ready' },
        },
      },
    },
    '/metrics': {
      get: {
        tags: ['ops'],
        summary: 'Prometheus metrics',
        security: [],
        responses: { '200': { description: 'text/plain' } },
      },
    },
  };

  return {
    openapi: '3.0.3',
    info: {
      title: 'Social Backend Public API',
      version: '0.2.0',
      description:
        'Gateway surface. Full monorepo scan: `pnpm openapi:export`. Errors use RFC 9457 application/problem+json.',
    },
    servers: [{ url: 'http://127.0.0.1:3000', description: 'Local gateway' }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT (EdDSA)',
        },
      },
      schemas: {
        Problem: {
          type: 'object',
          required: ['type', 'title', 'status'],
          properties: {
            type: { type: 'string', format: 'uri' },
            title: { type: 'string' },
            status: { type: 'integer' },
            detail: { type: 'string' },
            instance: { type: 'string' },
            traceId: { type: 'string' },
          },
        },
      },
    },
  };
}
