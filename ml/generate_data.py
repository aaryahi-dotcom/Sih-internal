"""
Synthetic transaction generator — stands in for IEEE-CIS on day 1.

Encodes the same fraud signals the brief calls out (odd-hour transfers, new
beneficiaries, amount deviation from a sender's own history) so the trained
model and its SHAP explanations behave like the real thing. Swap this for the
actual IEEE-CIS loader in Phase 0 Step 0.2 once the dataset is downloaded —
train.py doesn't care where the DataFrame comes from as long as the columns
in FEATURE_COLUMNS (see train.py) are present.
"""
import numpy as np
import pandas as pd

CHANNELS = ["UPI", "NEFT", "IMPS", "CARD"]
CHANNEL_CODE = {c: i for i, c in enumerate(CHANNELS)}

RNG = np.random.default_rng(42)


def _sender_pool(n_senders: int) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "sender_id": [f"user_{i}" for i in range(n_senders)],
            "avg_amount": RNG.lognormal(mean=7.5, sigma=0.6, size=n_senders),
        }
    )


def generate(n_rows: int = 20000, fraud_rate: float = 0.03, n_senders: int = 800) -> pd.DataFrame:
    senders = _sender_pool(n_senders)
    n_fraud = int(n_rows * fraud_rate)
    n_normal = n_rows - n_fraud

    rows = []

    # normal traffic: business hours, amounts near the sender's own average,
    # mostly repeat beneficiaries, mostly UPI
    normal_senders = senders.sample(n_normal, replace=True, random_state=1).reset_index(drop=True)
    for i in range(n_normal):
        avg = normal_senders.loc[i, "avg_amount"]
        amount = max(10.0, RNG.normal(loc=avg, scale=avg * 0.25))
        hour = int(np.clip(RNG.normal(loc=14, scale=4), 0, 23))
        sender_tx_count_1h = RNG.poisson(0.6)
        new_beneficiary = RNG.random() < 0.08
        channel = RNG.choice(CHANNELS, p=[0.7, 0.12, 0.13, 0.05])
        rows.append(
            {
                "sender_id": normal_senders.loc[i, "sender_id"],
                "avg_amount": avg,
                "amount": amount,
                "hour": hour,
                "sender_tx_count_1h": sender_tx_count_1h,
                "new_beneficiary": int(new_beneficiary),
                "channel": channel,
                "is_fraud": 0,
            }
        )

    # fraud: large deviation from average, odd hours, new beneficiaries,
    # bursty session activity, more likely to jump off UPI to NEFT/IMPS
    fraud_senders = senders.sample(n_fraud, replace=True, random_state=2).reset_index(drop=True)
    for i in range(n_fraud):
        avg = fraud_senders.loc[i, "avg_amount"]
        amount = max(50.0, avg * RNG.uniform(3, 12))
        hour = int(RNG.choice([1, 2, 3, 4, 23], p=[0.25, 0.25, 0.2, 0.15, 0.15]))
        sender_tx_count_1h = RNG.poisson(3.5)
        new_beneficiary = RNG.random() < 0.85
        channel = RNG.choice(CHANNELS, p=[0.3, 0.35, 0.3, 0.05])
        rows.append(
            {
                "sender_id": fraud_senders.loc[i, "sender_id"],
                "avg_amount": avg,
                "amount": amount,
                "hour": hour,
                "sender_tx_count_1h": sender_tx_count_1h,
                "new_beneficiary": int(new_beneficiary),
                "channel": channel,
                "is_fraud": 1,
            }
        )

    df = pd.DataFrame(rows).sample(frac=1, random_state=3).reset_index(drop=True)
    df["channel_code"] = df["channel"].map(CHANNEL_CODE)
    df["amount_deviation"] = (df["amount"] - df["avg_amount"]) / (df["avg_amount"] + 1.0)
    df["is_odd_hour"] = ((df["hour"] < 6) | (df["hour"] >= 23)).astype(int)
    return df


if __name__ == "__main__":
    df = generate()
    df.to_csv("ml/synthetic_transactions.csv", index=False)
    print(f"wrote {len(df)} rows, fraud rate={df['is_fraud'].mean():.3f}")
