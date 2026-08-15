CHANNEL_CODE = {"UPI": 0, "NEFT": 1, "IMPS": 2, "CARD": 3}

# Default thresholds, matching the brief's bands (Step 0.3). Mutable at
# runtime via GET/POST /api/v1/admin/thresholds — scoring.py reads these as
# module attributes on every call, so an admin update takes effect on the
# very next transaction. In-memory only: resets on server restart, same as
# everything else in this prototype (no Postgres yet).
APPROVE_THRESHOLD = 0.3
BLOCK_THRESHOLD = 0.7

# Section 5.1 of the brief: puppet_score > 0.7 AND session amount > 1L ->
# flag for human review regardless of the ML score. This is the one rule
# from the "puppet signature detection" differentiator that's actually wired
# up on day 1; the other three sub-signals (timing/session linearity) are
# not yet computed from real session data. Also admin-tunable, same as above.
PUPPET_SCORE_THRESHOLD = 0.7
PUPPET_SESSION_AMOUNT_THRESHOLD = 100_000

MODEL_PATH = "models/xgb_v1.pkl"
EXPLAINER_PATH = "models/shap_explainer_v1.pkl"
FEATURE_COLUMNS_PATH = "models/feature_columns.pkl"
