"""In-memory log of recently scored transactions — powers the dashboard's
live feed and stats bar. Same "swap for Postgres later" story as the feature
store; nothing here survives a restart."""
from collections import deque

_feed = deque(maxlen=200)


def log(entry: dict) -> None:
    _feed.appendleft(entry)


def get_feed(limit: int = 25) -> list:
    return list(_feed)[:limit]


def get_stats() -> dict:
    total = len(_feed)
    if total == 0:
        return {"transactions": 0, "alerts": 0, "avg_risk_score": 0.0}
    alerts = sum(1 for e in _feed if e["decision"] == "block")
    avg_risk_score = sum(e["risk_score"] for e in _feed) / total
    return {
        "transactions": total,
        "alerts": alerts,
        "avg_risk_score": round(avg_risk_score, 3),
    }
