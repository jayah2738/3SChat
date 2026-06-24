import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, megabytes, validateUploadSize } from './media';

describe('free-tier media limits', () => {
  it('accepts an upload at the configured limit', () => {
    expect(() => validateUploadSize({ size: IMAGE_MAX_BYTES }, IMAGE_MAX_BYTES, 'Image')).not.toThrow();
  });

  it('returns a clear error above the configured limit', () => {
    expect(() => validateUploadSize({ size: IMAGE_MAX_BYTES + 1 }, IMAGE_MAX_BYTES, 'Image'))
      .toThrow('Image must be 5 MB or smaller.');
  });

  it('formats byte limits for user-facing copy', () => {
    expect(megabytes(5 * 1024 * 1024)).toBe('5 MB');
  });
});
