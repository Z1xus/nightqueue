interface Bucket {
  tokens: number;
  updated: number;
}

export function tokenBucket(capacity: number, refillPerSecond: number) {
  const buckets = new Map<string, Bucket>();
  return (key: string): boolean => {
    const now = Date.now();
    const bucket = buckets.get(key) ?? { tokens: capacity, updated: now };
    bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.updated) / 1000) * refillPerSecond);
    bucket.updated = now;
    buckets.set(key, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  };
}
