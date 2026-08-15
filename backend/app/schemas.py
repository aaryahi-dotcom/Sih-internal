from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

Channel = Literal["UPI", "NEFT", "IMPS", "CARD"]
Decision = Literal["approve", "step-up", "block"]


class Transaction(BaseModel):
    transaction_id: str
    sender_id: str
    receiver_id: str
    amount: float = Field(gt=0)
    timestamp: datetime
    channel: Channel
    vpa: Optional[str] = None


class ScoreResponse(BaseModel):
    transaction_id: str
    risk_score: float
    decision: Decision
    shap_values: dict[str, float]
    puppet_score: float
    flagged_reason: Optional[str] = None
    graph_flags: dict[str, bool]
    session_amount_1h: float


class FeedbackRequest(BaseModel):
    transaction_id: str
    action: Literal["confirm_fraud", "override_approve"]
    reason: Optional[str] = None


class ThresholdConfig(BaseModel):
    approve_threshold: float = Field(ge=0, le=1)
    block_threshold: float = Field(ge=0, le=1)
    puppet_score_threshold: float = Field(ge=0, le=1)
    puppet_session_amount_threshold: float = Field(ge=0)
