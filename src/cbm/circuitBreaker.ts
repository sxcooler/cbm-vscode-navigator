export class CircuitBreaker {
  #failures = 0;
  #openedAt: number | undefined;

  constructor(
    readonly threshold = 3,
    readonly cooldownMs = 10_000,
    readonly now: () => number = Date.now,
  ) {}

  get failures(): number {
    return this.#failures;
  }

  canRequest(): boolean {
    if (this.#openedAt === undefined) return true;
    if (this.now() - this.#openedAt < this.cooldownMs) return false;
    this.recordSuccess();
    return true;
  }

  recordFailure(): void {
    this.#failures += 1;
    if (this.#failures >= this.threshold && this.#openedAt === undefined) {
      this.#openedAt = this.now();
    }
  }

  recordSuccess(): void {
    this.#failures = 0;
    this.#openedAt = undefined;
  }
}
