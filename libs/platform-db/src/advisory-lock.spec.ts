import { advisoryLockKey } from './advisory-lock';

describe('advisoryLockKey', () => {
  it('is stable for a name', () => {
    expect(advisoryLockKey('mention-repair')).toBe(
      advisoryLockKey('mention-repair'),
    );
    expect(advisoryLockKey('mention-repair')).not.toBe(
      advisoryLockKey('other-job'),
    );
  });
});
