import { createPostSchema } from './posts.validation';

describe('createPostSchema', () => {
  it('accepts valid content', () => {
    expect(createPostSchema.parse({ content: 'hello world' }).content).toBe(
      'hello world',
    );
  });

  it('rejects empty or overlong content', () => {
    expect(() => createPostSchema.parse({ content: '' })).toThrow();
    expect(() =>
      createPostSchema.parse({ content: 'x'.repeat(281) }),
    ).toThrow();
  });
});
