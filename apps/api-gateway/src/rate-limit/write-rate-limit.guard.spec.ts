import { resolveScope } from './write-rate-limit.guard';

describe('resolveScope', () => {
  it('classifies create / like / follow', () => {
    expect(resolveScope('POST', '/v1/posts')?.name).toBe('post:create');
    expect(resolveScope('POST', '/v1/posts/abc/likes')?.name).toBe('post:like');
    expect(resolveScope('DELETE', '/v1/posts/abc/likes')?.name).toBe(
      'post:like',
    );
    expect(resolveScope('POST', '/v1/graph/follows/uid')?.name).toBe(
      'graph:follow',
    );
    expect(resolveScope('GET', '/v1/posts')).toBeNull();
  });
});
