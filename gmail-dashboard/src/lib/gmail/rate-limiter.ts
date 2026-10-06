/**
 * Token bucket measured in Gmail quota units.
 * Gmail's per-user limit is 250 units/second (moving average); we stay
 * comfortably below it and still back off on 429s.
 * https://developers.google.com/workspace/gmail/api/reference/quota
 */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();

  constructor(
    private readonly unitsPerSecond: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }

  async take(units: number): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.unitsPerSecond);
      this.last = now;
      if (this.tokens >= units) {
        this.tokens -= units;
        return;
      }
      const waitMs = Math.ceil(((units - this.tokens) / this.unitsPerSecond) * 1000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

// Shared across all requests in this process (one user).
const g = globalThis as unknown as { __gmailLimiter?: RateLimiter };
export const gmailLimiter = (g.__gmailLimiter ??= new RateLimiter(150, 150));
