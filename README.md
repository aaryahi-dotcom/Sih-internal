# RiskPulse — Day 1 Prototype

A working slice of Phase 0 + a thin slice of Phase 1: a real trained
classifier with SHAP explanations behind `POST /api/v1/score`, the brief's
headline differentiator (puppet-signature detection, Section 5.1) actually
wired into the decision, a scenario simulator, and a light dashboard that
visualizes the pipeline live. No Redis/Postgres/Docker yet — feature history
is kept in an in-memory store (`backend/app/feature_store.py`) that mimics
the Redis interface described in Step 0.4, so it's a drop-in swap later.

The model is trained on a **small synthetic dataset** (`ml/generate_data.py`,
20k rows), not the real IEEE-CIS dataset, and uses scikit-learn's
`GradientBoostingClassifier` instead of XGBoost — XGBoost's macOS wheel needs
`libomp` via Homebrew, which isn't installed on this machine. Swapping either
back is a small, contained change (see comments in `ml/train.py`).

## Setup

```bash
cd riskpulse
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Train the model

```bash
python ml/train.py
```

Writes `backend/models/xgb_v1.pkl`, `shap_explainer_v1.pkl`, and
`feature_columns.pkl`.

## Run it

```bash
cd backend
uvicorn app.main:app --reload
```

Open **http://127.0.0.1:8000/** for the dashboard. API docs at `/docs`.

## What the dashboard shows

- **Pipeline visualizer** — lights up each stage (ingest → feature
  enrichment → ML scoring → graph analysis → decision engine → response) as
  a transaction is scored, matching the brief's Section 2 architecture.
- **Manual scoring form** — score any transaction by hand.
- **Demo scenarios** (`POST /api/v1/simulate/{scenario}`) — three small,
  synthetic, scripted transaction sequences:
  - `normal_traffic` — 6 ordinary transactions, all approve.
  - `digital_arrest` — a puppet-signature pattern (round repeated amounts,
    90s apart, new beneficiaries each time, 2am). The base ML score stays
    low (repeated amounts don't deviate from the sender's own average) but
    `puppet_score` climbs, and by the 3rd transaction the Section 5.1 rule
    (`puppet_score > 0.7` and session total > ₹1L) overrides the decision to
    `block` — this is the actual differentiator, not a mock.
  - `mule_ring` — 6 new senders paying the same collector account at 3am.
    This one **stays approved**, on purpose: spotting a shared-receiver
    pattern across unrelated senders needs the graph engine, which doesn't
    exist yet. That's the point of the "Coming soon: Transaction Graph" card.
- **Live feed + stats bar** — everything scored (manual or simulated) shows
  up here, kept in memory (`backend/app/txlog.py`).
- **Live threshold controls** (Overview tab) — drag the approve/block/puppet
  thresholds and every transaction already on screen instantly re-decides
  (recolored feed, charts, and the open Result panel). The same values are
  persisted server-side (`GET`/`POST /api/v1/admin/thresholds`) so the next
  transaction scored — manual, scenario, or autoplay — uses them too. A real,
  if lightweight, version of the brief's Phase 3 "Threshold Control Panel."
- **What-if amount slider** (Score & Decide tab) — drag the amount and watch
  the gauge, decision, and SHAP stem plot update live via
  `POST /api/v1/score/preview`, which runs the full pipeline but skips
  `store.record()` and the feed log, so dragging never pollutes a sender's
  history or floods the feed with phantom transactions. Nothing is committed
  until you click "Score transaction."
- **Auto-play live traffic** (header toggle, any tab) — injects one
  randomized transaction every ~1.8s through the real `/api/v1/score`
  endpoint (mostly ordinary traffic, occasionally an amount/beneficiary/hour
  spike), so the dashboard reads as a live monitoring wall instead of only
  reacting to clicks.
- **Coming soon cards** — operational layers from Phase 2/3 that are
  genuinely not built: analyst workbench, custom rule engine, transaction
  graph, contagion heatmap, model health monitor.

## Try the API directly

```bash
curl -X POST http://127.0.0.1:8000/api/v1/score \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_id": "tx001",
    "sender_id": "user_1",
    "receiver_id": "user_99",
    "amount": 75000,
    "timestamp": "2026-08-14T02:30:00",
    "channel": "IMPS",
    "vpa": "x8k2m@ybl"
  }'

curl -X POST http://127.0.0.1:8000/api/v1/simulate/digital_arrest
```

## What's faked vs real

| Faked now | Real version |
|---|---|
| Synthetic training data (20k rows) | IEEE-CIS 590K dataset (Kaggle) |
| sklearn GradientBoosting | XGBoost (needs libomp on this Mac) |
| In-memory feature store | Redis with TTL-managed counters |
| Thresholds live in memory, reset on server restart | Persisted + audited in PostgreSQL, with the replay-preview chart from Step 3.2 (Phase 3) |
| `puppet_score` = 3-signal heuristic + 1 wired rule | Full puppet detection: amount_regularity, timing_regularity, new_beneficiary_burst, session_linearity (Phase 2) |
| `graph_flags` always false, no graph engine | NetworkX pre-approval simulation, PageRank deltas, cycle detection (Phase 2) |
| In-memory feed/stats (`txlog.py`), no audit trail | PostgreSQL for audit trail + feedback (Phase 0.1 / Phase 3) |
| No Docker Compose | `docker-compose up` one-command deploy (Phase 0.1) |
| No analyst workbench / rule engine | Phase 3 operational layers |
| Auto-play traffic is random, not scenario-scripted | Real transaction stream from a bank's integration (Section 1.1) |

## Next steps (Phase 0 remainder, then Phase 1)

1. Add Docker Compose (FastAPI + Redis + Postgres).
2. Swap the in-memory feature store for real Redis.
3. Download IEEE-CIS from Kaggle, retrain `ml/train.py` on it; if libomp
   gets installed, swap `GradientBoostingClassifier` back to XGBoost.
4. Build the transaction graph engine (NetworkX) — the mule-ring scenario
   above is the concrete test case that motivates it.
