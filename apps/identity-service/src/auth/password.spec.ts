import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(hash, 'correct-horse-battery')).resolves.toBe(
      true,
    );
    await expect(verifyPassword(hash, 'wrong-password')).resolves.toBe(false);
  });
});
