import pytest
from db import VoteStore
from ratelimit import TokenBucket


@pytest.fixture
def store(tmp_path):
    return VoteStore(str(tmp_path / "t.db"), max_voters_per_ip_per_day=3)


def test_vote_then_change_side(store):
    assert store.cast("voter-0001", "ip1", "ng", "NG") == "created"
    assert store.cast("voter-0001", "ip1", "ng", "NG") == "unchanged"
    assert store.cast("voter-0001", "ip1", "gh", "NG") == "changed"
    r = store.results()
    assert r["totals"] == {"ng": 0, "gh": 1, "peace": 0}
    assert r["total"] == 1


def test_percent_and_countries(store):
    store.cast("voter-0001", "a", "ng", "NG")
    store.cast("voter-0002", "b", "ng", "NG")
    store.cast("voter-0003", "c", "gh", "GH")
    r = store.results()
    assert r["percent"]["ng"] == 66.7
    assert r["countries"][0] == {"country": "NG", "ng": 2, "gh": 0, "peace": 0, "total": 2}


def test_ip_limit(store):
    for i in range(3):
        assert store.cast(f"voter-000{i}", "same-ip", "ng", "NG") == "created"
    assert store.cast("voter-0009", "same-ip", "ng", "NG") == "ip_limit"


def test_invalid_side(store):
    with pytest.raises(ValueError):
        store.cast("voter-0001", "ip", "senegal", "SN")


def test_hourly_buckets(store):
    now = 1_800_000_000
    store.cast("voter-0001", "a", "ng", "NG", now=now - 30)
    store.cast("voter-0002", "b", "gh", "GH", now=now - 5 * 3600)
    h = store.results(now=now)["hourly"]
    assert len(h) == 24 and h[23]["ng"] == 1 and h[19]["gh"] == 1


def test_token_bucket():
    tb = TokenBucket(capacity=2, refill_per_sec=1)
    assert tb.allow("k", now=0)[0]
    assert tb.allow("k", now=0)[0]
    ok, wait = tb.allow("k", now=0)
    assert not ok and wait == pytest.approx(1.0)
    assert tb.allow("k", now=1.01)[0]
