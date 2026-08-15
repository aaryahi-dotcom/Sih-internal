import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from . import config, scoring, simulate, txlog
from .schemas import ScoreResponse, ThresholdConfig, Transaction

FRONTEND_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "frontend")
)

DISCLAIMER = (
    "Built in a single day of development to prove the core scoring pipeline "
    "end-to-end. This is not the production system described in the project "
    "brief, and no output here reflects production-grade accuracy.\n\n"
    "**Live in this build:** the scoring API, a trained classifier with "
    "genuine SHAP output, the puppet-signature rule (Section 5.1), and the "
    "scenario simulator.\n\n"
    "**Standing in for now:** a small synthetic dataset (not IEEE-CIS), "
    "scikit-learn in place of XGBoost, an in-memory store in place of Redis, "
    "no PostgreSQL or Docker Compose yet.\n\n"
    "**Coming soon:** the transaction graph engine, analyst workbench, rule "
    "engine, contagion heatmap, and a real IEEE-CIS-trained model. See the "
    "dashboard at `/` for the full breakdown."
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    scoring.load_models()
    yield


app = FastAPI(
    title="RiskPulse",
    version="0.1.0-prototype",
    description=f"**PROTOTYPE DISCLAIMER**\n\n{DISCLAIMER}",
    lifespan=lifespan,
)


def _log_entry(tx_id: str, sender_id: str, receiver_id: str, amount: float, channel: str, timestamp, result: dict) -> dict:
    entry = {
        "transaction_id": tx_id,
        "sender_id": sender_id,
        "receiver_id": receiver_id,
        "amount": amount,
        "channel": channel,
        "timestamp": timestamp.isoformat() if hasattr(timestamp, "isoformat") else str(timestamp),
        **result,
    }
    txlog.log(entry)
    return entry


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/v1/disclaimer")
def disclaimer():
    return {"disclaimer": DISCLAIMER}


@app.post("/api/v1/score", response_model=ScoreResponse)
def score(tx: Transaction):
    result = scoring.score_transaction(
        sender_id=tx.sender_id,
        receiver_id=tx.receiver_id,
        amount=tx.amount,
        channel=tx.channel,
        ts=tx.timestamp,
    )
    _log_entry(tx.transaction_id, tx.sender_id, tx.receiver_id, tx.amount, tx.channel, tx.timestamp, result)
    return ScoreResponse(transaction_id=tx.transaction_id, **result)


@app.post("/api/v1/score/preview", response_model=ScoreResponse)
def score_preview(tx: Transaction):
    """What-if scoring for the live amount slider: runs the real pipeline but
    skips store.record() and the feed log, so dragging the slider doesn't
    pollute the sender's rolling history or flood the live feed with
    phantom transactions."""
    result = scoring.score_transaction(
        sender_id=tx.sender_id,
        receiver_id=tx.receiver_id,
        amount=tx.amount,
        channel=tx.channel,
        ts=tx.timestamp,
        record=False,
    )
    return ScoreResponse(transaction_id=tx.transaction_id, **result)


@app.get("/api/v1/admin/thresholds", response_model=ThresholdConfig)
def get_thresholds():
    return ThresholdConfig(
        approve_threshold=config.APPROVE_THRESHOLD,
        block_threshold=config.BLOCK_THRESHOLD,
        puppet_score_threshold=config.PUPPET_SCORE_THRESHOLD,
        puppet_session_amount_threshold=config.PUPPET_SESSION_AMOUNT_THRESHOLD,
    )


@app.post("/api/v1/admin/thresholds", response_model=ThresholdConfig)
def set_thresholds(cfg: ThresholdConfig):
    if cfg.approve_threshold > cfg.block_threshold:
        raise HTTPException(status_code=400, detail="approve_threshold must be <= block_threshold")
    config.APPROVE_THRESHOLD = cfg.approve_threshold
    config.BLOCK_THRESHOLD = cfg.block_threshold
    config.PUPPET_SCORE_THRESHOLD = cfg.puppet_score_threshold
    config.PUPPET_SESSION_AMOUNT_THRESHOLD = cfg.puppet_session_amount_threshold
    return get_thresholds()


@app.post("/api/v1/simulate/{scenario}")
def simulate_scenario(scenario: str):
    if scenario not in simulate.SCENARIOS:
        raise HTTPException(status_code=404, detail=f"unknown scenario: {scenario}")
    results = simulate.run_scenario(scenario)
    for r in results:
        _log_entry(
            r["transaction_id"], r["sender_id"], r["receiver_id"], r["amount"], r["channel"], r["timestamp"],
            {
                "risk_score": r["risk_score"],
                "decision": r["decision"],
                "shap_values": r["shap_values"],
                "puppet_score": r["puppet_score"],
                "flagged_reason": r["flagged_reason"],
                "graph_flags": r["graph_flags"],
                "session_amount_1h": r["session_amount_1h"],
            },
        )
    return {"scenario": scenario, "count": len(results), "results": results}


@app.get("/api/v1/feed")
def feed(limit: int = 25):
    return txlog.get_feed(limit)


@app.get("/api/v1/stats")
def stats():
    return txlog.get_stats()


@app.middleware("http")
async def no_cache_static(request, call_next):
    """Prototype is under active iteration — force the browser to
    revalidate index.html/style.css/app.js on every load instead of
    trusting a stale disk cache (StaticFiles sets no Cache-Control header
    by default, so browsers fall back to heuristic caching)."""
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
