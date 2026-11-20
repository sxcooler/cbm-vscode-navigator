import { describe, expect, it } from 'vitest';
import { redactLog } from './logging.js';

describe('redactLog', () => {
  it('removes credentials and unrelated absolute paths while preserving authorized roots', () => {
    const result = redactLog(
      'Authorization: Bearer secret-token sk-proj-abc C:/repo/src/A.java C:/Users/name/private.txt',
      ['C:/repo'],
    );
    expect(result).toContain('C:/repo/src/A.java');
    expect(result).not.toContain('secret-token');
    expect(result).not.toContain('sk-proj-abc');
    expect(result).not.toContain('C:/Users/name/private.txt');
  });
});
