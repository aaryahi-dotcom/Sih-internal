"""
In-memory feature store — stands in for Redis on day 1.

Same responsibilities the brief assigns to Redis (Step 0.4): per-sender
transaction count in the last hour, running average amount, session amount in
the last hour, and the set of beneficiaries seen so far. Swap this class for
a Redis-backed one later; callers only use get_features()/record() so the
rest of the app won't change.
"""
from collections import defaultdict
from datetime import datetime, timedelta


class InMemoryFeatureStore:
    def __init__(self):
        self._history: dict[str, list[tuple[datetime, float]]] = defaultdict(list)
        self._beneficiaries: dict[str, set[str]] = defaultdict(set)

    def get_features(self, sender_id: str, now: datetime) -> dict:
        history = self._history[sender_id]
        recent = [(t, a) for t, a in history if now - t <= timedelta(hours=1)]
        all_amounts = [a for _, a in history]
        avg_amount = sum(all_amounts) / len(all_amounts) if all_amounts else 0.0
        return {
            "sender_tx_count_1h": len(recent),
            "avg_amount": avg_amount,
            "session_amount_1h": sum(a for _, a in recent),
        }

    def is_new_beneficiary(self, sender_id: str, receiver_id: str) -> bool:
        return receiver_id not in self._beneficiaries[sender_id]

    def record(self, sender_id: str, receiver_id: str, amount: float, now: datetime) -> None:
        self._history[sender_id].append((now, amount))
        self._beneficiaries[sender_id].add(receiver_id)


store = InMemoryFeatureStore()
