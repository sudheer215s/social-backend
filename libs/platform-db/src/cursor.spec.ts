import { decodeCursor, encodeCursor, paginateRows } from './cursor';

describe('cursor pagination helpers', () => {
  it('round-trips payload', () => {
    const c = encodeCursor({ id: 'abc', t: 1 });
    expect(decodeCursor<{ id: string; t: number }>(c)).toEqual({
      id: 'abc',
      t: 1,
    });
  });

  it('paginates with has_more', () => {
    const rows = [1, 2, 3, 4].map((n) => ({ id: String(n) }));
    const page = paginateRows(rows, 3, (r) => ({ id: r.id }));
    expect(page.items).toHaveLength(3);
    expect(page.page.has_more).toBe(true);
    expect(page.page.next_cursor).toBeTruthy();
    const cur = decodeCursor<{ id: string }>(page.page.next_cursor!);
    expect(cur.id).toBe('3');
  });

  it('ends cleanly', () => {
    const page = paginateRows([{ id: '1' }], 20, (r) => ({ id: r.id }));
    expect(page.page.has_more).toBe(false);
    expect(page.page.next_cursor).toBeNull();
  });
});
