import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index';

describe('@tilewright/playbot', () => {
  it('loads', () => {
    expect(PACKAGE_NAME).toBe('@tilewright/playbot');
  });
});

