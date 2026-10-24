import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '@tilewright/behaviors';

describe('@tilewright/behaviors', () => {
  it('loads', () => {
    expect(PACKAGE_NAME).toBe('@tilewright/behaviors');
  });
});

