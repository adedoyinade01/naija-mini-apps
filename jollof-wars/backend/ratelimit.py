"""In-memory token-bucket rate limiter, keyed by hashed IP."""
import threading
import time


class TokenBucket:
    def __init__(self, capacity: int, refill_per_sec: float):
        self.capacity = capacity
        self.rate = refill_per_sec
        self._buckets: dict[str, tuple[float, float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, now: float | None = None) -> tuple[bool, float]:
        """Returns (allowed, seconds_until_next_token)."""
        now = time.monotonic() if now is None else now
        with self._lock:
            tokens, last = self._buckets.get(key, (float(self.capacity), now))
            tokens = min(self.capacity, tokens + (now - last) * self.rate)
            if tokens >= 1:
                self._buckets[key] = (tokens - 1, now)
                return True, 0.0
            self._buckets[key] = (tokens, now)
            return False, (1 - tokens) / self.rate

    def cleanup(self, older_than_sec: float = 3600):
        cutoff = time.monotonic() - older_than_sec
        with self._lock:
            for k in [k for k, (_, last) in self._buckets.items() if last < cutoff]:
                del self._buckets[k]
