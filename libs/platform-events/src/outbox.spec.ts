import { outboxDdl } from './outbox';

describe('outboxDdl', () => {
  it('embeds schema name in table and index', () => {
    const sql = outboxDdl('post');
    expect(sql).toContain('post.outbox');
    expect(sql).toContain('ix_post_outbox_unpublished');
  });
});
