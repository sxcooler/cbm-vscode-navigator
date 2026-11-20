import { describe, expect, it, vi } from 'vitest';
import { setKeymap } from './commands.js';

describe('setKeymap', () => {
  it('updates only the extension keymap setting', async () => {
    const update = vi.fn(async () => undefined);
    await setKeymap({ update }, 'idea');
    expect(update).toHaveBeenCalledWith('keymap', 'idea', true);
  });
});
