import { createPostSchema } from './posts.validation';

describe('createPostSchema', () => {
  it('accepts valid content', () => {
    expect(createPostSchema.parse({ content: 'hello world' }).content).toBe(
      'hello world',
    );
  });

  it('rejects empty or overlong content for originals', () => {
    expect(() => createPostSchema.parse({ content: '' })).toThrow();
    expect(() =>
      createPostSchema.parse({ content: 'x'.repeat(281) }),
    ).toThrow();
  });

  it('allows empty content for pure repost', () => {
    const id = '018f0000-0000-7000-8000-000000000001';
    const parsed = createPostSchema.parse({ repostOfId: id });
    expect(parsed.repostOfId).toBe(id);
    expect(parsed.content).toBe('');
  });

  it('rejects reply + repost together', () => {
    const id = '018f0000-0000-7000-8000-000000000001';
    expect(() =>
      createPostSchema.parse({
        content: 'x',
        replyToId: id,
        repostOfId: id,
      }),
    ).toThrow();
  });

  it('accepts quote repost with content', () => {
    const id = '018f0000-0000-7000-8000-000000000001';
    const parsed = createPostSchema.parse({
      content: 'my take',
      repostOfId: id,
    });
    expect(parsed.content).toBe('my take');
  });
});
