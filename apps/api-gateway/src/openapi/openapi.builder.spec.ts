import { buildGatewayOpenApi } from './openapi.builder';

describe('buildGatewayOpenApi', () => {
  it('includes core public paths', () => {
    const doc = buildGatewayOpenApi() as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.paths['/v1/posts']).toBeTruthy();
    expect(doc.paths['/v1/timelines/home']).toBeTruthy();
    expect(doc.paths['/v1/auth/logout-all']).toBeTruthy();
  });
});
