import { parseClientFrame } from './protocol';

describe('parseClientFrame', () => {
  it('parses ping and rejects garbage', () => {
    expect(parseClientFrame('{"t":"ping"}')).toEqual({ t: 'ping' });
    expect(parseClientFrame('not-json')).toBeNull();
    expect(parseClientFrame('{}')).toBeNull();
  });
});
