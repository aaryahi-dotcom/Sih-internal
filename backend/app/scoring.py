"""
Model loading + inference + SHAP explanation + decisioning.

puppet_score here is a placeholder heuristic (new-beneficiary + burst +
odd-hour), not the real Phase 2 puppet_score (amount_regularity /
timing_regularity / new_beneficiary_burst / session_linearity — Section 5.1
of the brief). graph_flags is a stub since the graph engine doesn't exist
until Phase 1. Both are wired into the response contract now so the API
shape doesn't change later.
"""
from datetime import datetime
from typing import Optional

import joblib
import pandas as pd

from . import config
from .feature_store import store

_model = None
_explainer = None
_feature_columns: Optional[list] = None


def load_models() -> None:
    global _model, _explainer, _feature_columns
    _model = joblib.load(config.MODEL_PATH)
    _explainer = joblib.load(config.EXPLAINER_PATH)
    _feature_columns = joblib.load(config.FEATURE_COLUMNS_PATH)


def _build_feature_row(sender_id: str, receiver_id: str, amount: float, channel: str, ts: datetime) -> pd.DataFrame:
    hist = store.get_features(sender_id, ts)
    new_beneficiary = store.is_new_beneficiary(sender_id, receiver_id)
    avg_amount = hist["avg_amount"]
    # no prior history for this sender yet -> no deviation signal to compute,
    # rather than treating "no average" as "average of zero" (which would
    # make amount_deviation spike to ~amount and swamp every other feature)
    amount_deviation = 0.0 if avg_amount == 0 else (amount - avg_amount) / (avg_amount + 1.0)
    hour = ts.hour
    session_amount_1h = hist["session_amount_1h"] + amount

    row = {
        "amount": amount,
        "hour": hour,
        "is_odd_hour": int(hour < 6 or hour >= 23),
        "sender_tx_count_1h": hist["sender_tx_count_1h"],
        "new_beneficiary": int(new_beneficiary),
        "channel_code": config.CHANNEL_CODE[channel],
        "amount_deviation": amount_deviation,
    }
    row["session_amount_1h"] = session_amount_1h
    return pd.DataFrame([row], columns=_feature_columns), row


def _decision_for(score: float) -> str:
    if score < config.APPROVE_THRESHOLD:
        return "approve"
    if score < config.BLOCK_THRESHOLD:
        return "step-up"
    return "block"


def _puppet_score(row: dict) -> float:
    signals = [
        row["new_beneficiary"],
        min(row["sender_tx_count_1h"] / 3.0, 1.0),
        row["is_odd_hour"],
    ]
    return round(sum(signals) / len(signals), 3)


def score_transaction(
    sender_id: str, receiver_id: str, amount: float, channel: str, ts: datetime, record: bool = True
) -> dict:
    X, row = _build_feature_row(sender_id, receiver_id, amount, channel, ts)

    risk_score = float(_model.predict_proba(X)[0, 1])
    shap_row = _explainer.shap_values(X)[0]
    shap_values = {col: round(float(val), 4) for col, val in zip(_feature_columns, shap_row)}

    puppet_score = _puppet_score(row)
    decision = _decision_for(risk_score)
    flagged_reason = None

    if (
        puppet_score > config.PUPPET_SCORE_THRESHOLD
        and row["session_amount_1h"] > config.PUPPET_SESSION_AMOUNT_THRESHOLD
    ):
        decision = "block"
        flagged_reason = "puppet_signature"

    result = {
        "risk_score": round(risk_score, 4),
        "decision": decision,
        "shap_values": shap_values,
        "puppet_score": puppet_score,
        "flagged_reason": flagged_reason,
        "graph_flags": {"cycle_detected": False, "bridges_suspicious_cluster": False},
        "session_amount_1h": round(row["session_amount_1h"], 2),
    }

    if record:
        store.record(sender_id, receiver_id, amount, ts)
    return result
