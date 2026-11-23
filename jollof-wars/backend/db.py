"""SQLite storage for Jollof Wars votes.

One row per voter. Voting again changes your side instead of adding a vote.
"""
import sqlite3
import threading
import time
from contextlib import contextmanager

SIDES = ("ng", "gh", "peace")

SCHEMA = """
CREATE TABLE IF NOT EXISTS votes (
    voter_id   TEXT PRIMARY KEY,
    ip_hash    TEXT NOT NULL,
    side       TEXT NOT NULL CHECK (side IN ('ng', 'gh', 'peace')),
    country    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_votes_ip ON votes (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_votes_updated ON votes (updated_at);
"""


class VoteStore:
    def __init__(self, path: str, max_voters_per_ip_per_day: int = 5):
        self.path = path
        self.max_per_ip = max_voters_per_ip_per_day
        self._lock = threading.Lock()
        self.version = 0  # bumps on every change; the live stream watches this
        with self._conn() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def cast(self, voter_id: str, ip_hash: str, side: str, country: str, now: int | None = None) -> str:
        """Returns 'created', 'changed', 'unchanged' or 'ip_limit'."""
        if side not in SIDES:
            raise ValueError("invalid side")
        now = now or int(time.time())
        with self._lock, self._conn() as c:
            row = c.execute("SELECT side, country FROM votes WHERE voter_id = ?", (voter_id,)).fetchone()
            if row:
                if row["side"] == side and row["country"] == country:
                    return "unchanged"
                c.execute(
                    "UPDATE votes SET side = ?, country = ?, updated_at = ? WHERE voter_id = ?",
                    (side, country, now, voter_id),
                )
                self.version += 1
                return "changed"

            recent = c.execute(
                "SELECT COUNT(*) FROM votes WHERE ip_hash = ? AND created_at > ?",
                (ip_hash, now - 86400),
            ).fetchone()[0]
            if recent >= self.max_per_ip:
                return "ip_limit"

            c.execute(
                "INSERT INTO votes (voter_id, ip_hash, side, country, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (voter_id, ip_hash, side, country, now, now),
            )
            self.version += 1
            return "created"

    def my_vote(self, voter_id: str):
        with self._conn() as c:
            row = c.execute("SELECT side, country FROM votes WHERE voter_id = ?", (voter_id,)).fetchone()
            return dict(row) if row else None

    def results(self, now: int | None = None) -> dict:
        now = now or int(time.time())
        with self._conn() as c:
            totals = {s: 0 for s in SIDES}
            for r in c.execute("SELECT side, COUNT(*) n FROM votes GROUP BY side"):
                totals[r["side"]] = r["n"]

            by_country = {}
            for r in c.execute("SELECT country, side, COUNT(*) n FROM votes GROUP BY country, side"):
                by_country.setdefault(r["country"], {s: 0 for s in SIDES})[r["side"]] = r["n"]
            countries = sorted(
                ({"country": k, **v, "total": sum(v.values())} for k, v in by_country.items()),
                key=lambda x: -x["total"],
            )

            # votes per hour for the last 24 hours (oldest first)
            start = now - 24 * 3600
            hourly = [{s: 0 for s in SIDES} for _ in range(24)]
            for r in c.execute("SELECT side, updated_at FROM votes WHERE updated_at > ?", (start,)):
                idx = min(23, (r["updated_at"] - start) // 3600)
                hourly[idx][r["side"]] += 1

        total = sum(totals.values())
        return {
            "totals": totals,
            "total": total,
            "percent": {s: (round(100 * n / total, 1) if total else 0) for s, n in totals.items()},
            "countries": countries[:15],
            "hourly": hourly,
            "version": self.version,
        }
