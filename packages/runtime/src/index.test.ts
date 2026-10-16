import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index';

describe('@tilewright/runtime', () => {
  it('loads', () => {
    expect(PACKAGE_NAME).toBe('@tilewright/runtime');
  });
});

