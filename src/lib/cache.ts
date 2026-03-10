interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class InMemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();

  set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  // Evict stale entries periodically
  prune(): void {
    const now = Date.now();
    Array.from(this.store.entries()).forEach(([key, entry]) => {
      if (now > entry.expiresAt) this.store.delete(key);
    });
  }
}

// Singleton — persists across requests in the same Node.js process
const globalForCache = global as typeof global & { _govCache?: InMemoryCache };
export const cache: InMemoryCache =
  globalForCache._govCache ?? (globalForCache._govCache = new InMemoryCache());

export const CACHE_TTL_MS = 30 * 60 * 1000;        // 30 minutes for list results
export const CACHE_TTL_DETAIL_MS = 60 * 60 * 1000; // 60 minutes for detail pages
