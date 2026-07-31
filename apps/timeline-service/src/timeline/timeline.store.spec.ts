import { timelineKey } from './timeline.store';

describe('timelineKey', () => {
  it('namespaces home timelines', () => {
    expect(timelineKey('u1')).toBe('tl:h:u1');
  });
});
