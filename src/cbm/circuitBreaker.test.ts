import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from './circuitBreaker.js';

describe('CircuitBreaker', () => {
  it('opens after repeated failures and closes after its cooldown', () => {
    let now = 1000;
    const breaker = new CircuitBreaker(3, 500, () => now);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.canRequest()).toBe(true);
    breaker.recordFailure();
    expect(breaker.canRequest()).toBe(false);
    now = 1500;
    expect(breaker.canRequest()).toBe(true);
    expect(breaker.failures).toBe(0);
  });

  it('resets immediately after success', () => {
    const breaker = new CircuitBreaker(2, 500, () => 0);
    breaker.recordFailure();
    breaker.recordSuccess();
    expect(breaker.failures).toBe(0);
  });
});
