import { updateProfileSchema } from './profile.validation';

describe('updateProfileSchema', () => {
  it('accepts partial updates', () => {
    expect(
      updateProfileSchema.parse({ displayName: 'Ada', bio: 'notes' }),
    ).toEqual({ displayName: 'Ada', bio: 'notes' });
  });

  it('rejects empty patch', () => {
    expect(() => updateProfileSchema.parse({})).toThrow();
  });

  it('rejects invalid username', () => {
    expect(() => updateProfileSchema.parse({ username: 'ab' })).toThrow();
  });
});
