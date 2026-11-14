import type { CacheStore } from "./cache.js";
import type { ManagedStore } from "./managed.js";

/**
 * Persists managed + cache state periodically during a run (so a killed process loses little)
 * and once more at the end. Saves are serialised; at most one is pending at a time.
 */
export class StateSaver {
  private timer: NodeJS.Timeout | undefined;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly managed: ManagedStore,
    private readonly cache: CacheStore,
    private readonly delayMs = 250,
  ) {}

  private flush(): Promise<void> {
    this.chain = this.chain.then(async () => {
      await this.managed.save();
      await this.cache.save();
    });
    return this.chain;
  }

  schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.delayMs);
  }

  async final(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.flush();
  }
}
