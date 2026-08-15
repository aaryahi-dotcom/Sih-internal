"""
Scenario simulator — the brief's demo tool (Section 1.1 / Step 1.4), not the
product. Generates a handful of transactions per scenario and scores each
through the real pipeline (scoring.score_transaction), so the dashboard shows
genuine model output, not scripted numbers. Each run gets a fresh random
sender id prefix so re-running a scenario starts cold rather than inheriting
the previous run's session history.

Deliberately small (5-8 transactions/scenario) per the "very small dataset"
constraint for this prototype — full scenario generators with realistic
volume are a later-phase concern.
"""
import uuid
from datetime import datetime, timedelta

from . import scoring

SCENARIOS = ["normal_traffic", "digital_arrest", "mule_ring"]


def _run_id() -> str:
    return uuid.uuid4().hex[:6]


def _tx_id() -> str:
    return f"sim_{uuid.uuid4().hex[:8]}"


def _score_all(specs: list[dict]) -> list[dict]:
    results = []
    for spec in specs:
        result = scoring.score_transaction(
            sender_id=spec["sender_id"],
            receiver_id=spec["receiver_id"],
            amount=spec["amount"],
            channel=spec["channel"],
            ts=spec["timestamp"],
        )
        results.append({"transaction_id": _tx_id(), **spec, **result})
    return results


def normal_traffic() -> list[dict]:
    run = _run_id()
    base = datetime.now().replace(hour=13, minute=0, second=0, microsecond=0)
    plan = [
        (f"user_{run}_a", "merchant_grocery", 480, "UPI"),
        (f"user_{run}_b", "merchant_electric_co", 2200, "UPI"),
        (f"user_{run}_a", "merchant_grocery", 510, "UPI"),
        (f"user_{run}_c", "friend_raj", 1500, "UPI"),
        (f"user_{run}_b", "merchant_electric_co", 2150, "UPI"),
        (f"user_{run}_d", "landlord_flat3b", 18000, "NEFT"),
    ]
    specs = []
    for i, (sender, receiver, amount, channel) in enumerate(plan):
        specs.append(
            {
                "sender_id": sender,
                "receiver_id": receiver,
                "amount": float(amount),
                "channel": channel,
                "timestamp": base + timedelta(minutes=i * 4),
            }
        )
    return _score_all(specs)


def digital_arrest() -> list[dict]:
    """Puppet-signature pattern: round repeated amounts, ~90s apart, new
    beneficiaries each time, odd hour — Section 5.1 of the brief."""
    run = _run_id()
    victim = f"victim_{run}"
    base = datetime.now().replace(hour=2, minute=0, second=0, microsecond=0)
    specs = []
    for i in range(5):
        specs.append(
            {
                "sender_id": victim,
                "receiver_id": f"mule_beneficiary_{run}_{i}",
                "amount": 50000.0,
                "channel": "IMPS",
                "timestamp": base + timedelta(seconds=90 * i),
            }
        )
    return _score_all(specs)


def mule_ring() -> list[dict]:
    """Dormant accounts activating in a burst to the same collector account,
    odd hour, large sums. Real mule-ring detection needs the graph engine
    (Phase 1/2) to spot the shared-receiver structure; this scenario still
    scores each leg individually so the feed and per-tx model output are
    real, but graph_flags stays a stub until that engine exists."""
    run = _run_id()
    collector = f"collector_{run}"
    base = datetime.now().replace(hour=3, minute=0, second=0, microsecond=0)
    specs = []
    for i in range(6):
        specs.append(
            {
                "sender_id": f"mule_{run}_{i}",
                "receiver_id": collector,
                "amount": 45000.0 + i * 500,
                "channel": "IMPS",
                "timestamp": base + timedelta(seconds=20 * i),
            }
        )
    return _score_all(specs)


RUNNERS = {
    "normal_traffic": normal_traffic,
    "digital_arrest": digital_arrest,
    "mule_ring": mule_ring,
}


def run_scenario(name: str) -> list[dict]:
    if name not in RUNNERS:
        raise ValueError(f"unknown scenario: {name}")
    return RUNNERS[name]()
