import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index';

describe('@tilewright/exporter', () => {
  it('loads', () => {
    expect(PACKAGE_NAME).toBe('@tilewright/exporter');
  });
});

