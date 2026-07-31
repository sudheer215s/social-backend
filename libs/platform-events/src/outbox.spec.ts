import { outboxDdl, outboxReliabilityAlterDdl } from './outbox';

describe('outboxDdl', () => {
  it('embeds schema name and reliability columns', () => {
    const sql = outboxDdl('post');
    expect(sql).toContain('post.outbox');
    expect(sql).toContain('ix_post_outbox_unpublished');
    expect(sql).toContain('attempts');
    expect(sql).toContain('poisoned_at');
    expect(sql).toContain('locked_until');
  });
});

describe('outboxReliabilityAlterDdl', () => {
  it('adds reliability columns idempotently', () => {
    const sql = outboxReliabilityAlterDdl('graph');
    expect(sql).toContain('graph.outbox');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS attempts');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS poisoned_at');
    expect(sql).toContain('ix_graph_outbox_claimable');
  });
});
