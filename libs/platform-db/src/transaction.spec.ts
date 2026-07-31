import {
  DEADLOCK_DETECTED,
  SERIALIZATION_FAILURE,
  isRetryableTxError,
  withRetryOnSerialization,
} from './transaction';

describe('isRetryableTxError', () => {
  it('detects serialization and deadlock SQLSTATEs', () => {
    expect(isRetryableTxError({ code: SERIALIZATION_FAILURE })).toBe(true);
    expect(isRetryableTxError({ code: DEADLOCK_DETECTED })).toBe(true);
    expect(isRetryableTxError({ code: '23505' })).toBe(false);
    expect(isRetryableTxError(new Error('nope'))).toBe(false);
  });
});

describe('withRetryOnSerialization', () => {
  it('returns on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(withRetryOnSerialization(fn, 3)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries serialization failures then succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ code: SERIALIZATION_FAILURE })
      .mockRejectedValueOnce({ code: DEADLOCK_DETECTED })
      .mockResolvedValueOnce(42);

    await expect(withRetryOnSerialization(fn, 3)).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops after maxAttempts and rethrows', async () => {
    const err = { code: SERIALIZATION_FAILURE, message: 'conflict' };
    const fn = jest.fn().mockRejectedValue(err);
    await expect(withRetryOnSerialization(fn, 2)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable errors', async () => {
    const err = { code: '23505' };
    const fn = jest.fn().mockRejectedValue(err);
    await expect(withRetryOnSerialization(fn, 5)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
