import { parseAdminUserIds } from './admin.guard';

describe('parseAdminUserIds', () => {
  it('parses comma list', () => {
    const set = parseAdminUserIds({
      ADMIN_USER_IDS: ' aaa ,bbb,  ',
    });
    expect(set.has('aaa')).toBe(true);
    expect(set.has('bbb')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('empty when unset', () => {
    expect(parseAdminUserIds({}).size).toBe(0);
  });
});
