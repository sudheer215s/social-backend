import { MemorySidRevocationStore } from './revocation';

describe('MemorySidRevocationStore', () => {
  it('revokes and reports sid status', async () => {
    const store = new MemorySidRevocationStore();
    await expect(store.isRevoked('s1')).resolves.toBe(false);
    await store.revoke('s1', 60);
    await expect(store.isRevoked('s1')).resolves.toBe(true);
    await store.revokeMany(['s2', 's3'], 60);
    await expect(store.isRevoked('s2')).resolves.toBe(true);
    await expect(store.isRevoked('s3')).resolves.toBe(true);
  });
});
