import { isDockerAvailable } from './docker';

describe('isDockerAvailable', () => {
  it('returns a boolean without throwing', async () => {
    const available = await isDockerAvailable();
    expect(typeof available).toBe('boolean');
  });
});
