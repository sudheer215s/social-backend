import { sanitizeUserText } from './sanitize';

describe('sanitizeUserText', () => {
  it('strips HTML tags', () => {
    expect(sanitizeUserText('hello <script>alert(1)</script> world')).toBe(
      'hello alert(1) world',
    );
  });

  it('strips null and control chars but keeps newline/tab', () => {
    expect(sanitizeUserText('a\u0000b\tc\nd\u0007e')).toBe('ab\tc\nde');
  });

  it('leaves plain text alone', () => {
    expect(sanitizeUserText('hello @user #tag')).toBe('hello @user #tag');
  });
});
