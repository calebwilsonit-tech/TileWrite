import { describe, expect, it } from 'vitest';
import { compareReleases, engineTooOld } from './version';

describe('release numbers', () => {
  it('compares them part by part', () => {
    expect(compareReleases('0.1.0', '0.1.0')).toBe(0);
    expect(compareReleases('0.1.0', '0.0.9')).toBe(1);
    expect(compareReleases('0.9.0', '0.10.0')).toBe(-1);
    expect(compareReleases('1.0.0', '0.99.99')).toBe(1);
  });
  it('says so when the running Tilewright is older than the project needs', () => {
    expect(engineTooOld({ engine: '0.2.0' }, '0.1.0')).toMatch(/needs Tilewright 0.2.0/);
    expect(engineTooOld({ engine: '0.1.0' }, '0.1.0')).toBeNull();
    expect(engineTooOld({}, '0.0.1')).toBeNull();
  });
});
