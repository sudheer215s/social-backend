import { extractHashtags, extractMentions } from './text-extract';

describe('extractMentions', () => {
  it('finds usernames and dedupes case-insensitively', () => {
    expect(extractMentions('hi @Alice and @alice and @bob!')).toEqual([
      'alice',
      'bob',
    ]);
  });

  it('ignores email-like tokens and short handles', () => {
    expect(extractMentions('mail me@x.com or @ab or @_ok_user')).toEqual([
      '_ok_user',
    ]);
  });

  it('caps at 10', () => {
    const body = Array.from({ length: 15 }, (_, i) => `@user${i}aa`).join(' ');
    expect(extractMentions(body)).toHaveLength(10);
  });
});

describe('extractHashtags', () => {
  it('normalises and preserves display casing', () => {
    expect(extractHashtags('Love #NestJS and #nestjs')).toEqual([
      { tag: 'nestjs', display: 'NestJS' },
    ]);
  });
});
