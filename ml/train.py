"""
Trains the day-1 fraud classifier + SHAP explainer on synthetic data.

Uses sklearn's GradientBoostingClassifier instead of the brief's XGBoost:
XGBoost's macOS wheel needs libomp (via Homebrew), which isn't installed on
this machine. GradientBoostingClassifier needs no native library and SHAP's
TreeExplainer supports it the same way XGBoost is supported, so nothing else
in the pipeline (features, SHAP, FastAPI) changes. Swap back to xgb.XGBClassifier
here once libomp is available — the saved joblib artifact is the only thing
that changes; scoring.py just calls predict_proba() on whatever's loaded.

Run: python ml/train.py
Outputs: backend/models/xgb_v1.pkl, backend/models/shap_explainer_v1.pkl

Replace generate_data.generate() with the real IEEE-CIS loader when the
dataset is downloaded (Phase 0 Step 0.2) — everything downstream of the
DataFrame (feature columns, train/test split, model, SHAP) stays the same.
"""
import joblib
import shap
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split

from generate_data import generate

FEATURE_COLUMNS = [
    "amount",
    "hour",
    "is_odd_hour",
    "sender_tx_count_1h",
    "new_beneficiary",
    "channel_code",
    "amount_deviation",
]


def main():
    df = generate(n_rows=20000, fraud_rate=0.03)
    X = df[FEATURE_COLUMNS]
    y = df["is_fraud"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=0
    )

    # GradientBoostingClassifier has no scale_pos_weight, so mimic it with
    # sample weights instead (same effect as XGBoost's imbalance handling)
    pos_weight = (y_train == 0).sum() / (y_train == 1).sum()
    sample_weight = y_train.map({0: 1.0, 1: pos_weight})

    model = GradientBoostingClassifier(
        n_estimators=150,
        max_depth=4,
        learning_rate=0.1,
        random_state=0,
    )
    model.fit(X_train, y_train, sample_weight=sample_weight)

    preds = model.predict(X_test)
    probs = model.predict_proba(X_test)[:, 1]
    from sklearn.metrics import f1_score, precision_score, recall_score, roc_auc_score

    print(f"precision={precision_score(y_test, preds):.3f}")
    print(f"recall={recall_score(y_test, preds):.3f}")
    print(f"f1={f1_score(y_test, preds):.3f}")
    print(f"roc_auc={roc_auc_score(y_test, probs):.3f}")

    explainer = shap.TreeExplainer(model)

    joblib.dump(model, "backend/models/xgb_v1.pkl")
    joblib.dump(explainer, "backend/models/shap_explainer_v1.pkl")
    joblib.dump(FEATURE_COLUMNS, "backend/models/feature_columns.pkl")
    print("saved model + explainer to backend/models/")


if __name__ == "__main__":
    main()
