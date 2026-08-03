import { describe, expect, it } from 'vitest';
import { loginUrlWithNext, safeNextPath } from './safe-next';

describe('safeNextPath (F1-T03)', () => {
  it('returns relative paths unchanged', () => {
    expect(safeNextPath('/home')).toBe('/home');
    expect(safeNextPath('/settings/profile')).toBe('/settings/profile');
  });

  it('rejects open redirects', () => {
    expect(safeNextPath('https://evil.com')).toBe('/home');
    expect(safeNextPath('//evil.com')).toBe('/home');
    expect(safeNextPath('/\\evil.com')).toBe('/\\evil.com'); // still relative path
    expect(safeNextPath('/http://evil.com')).toBe('/home');
  });

  it('falls back for empty/null', () => {
    expect(safeNextPath(null)).toBe('/home');
    expect(safeNextPath('')).toBe('/home');
    expect(safeNextPath(undefined, '/search')).toBe('/search');
  });
});

describe('loginUrlWithNext (F1-T03)', () => {
  it('encodes next query param', () => {
    expect(loginUrlWithNext('/home')).toBe('/login?next=%2Fhome');
    expect(loginUrlWithNext('https://evil.com')).toBe('/login?next=%2Fhome');
  });
});
