from pydantic import BaseModel
from typing import Optional


class PredictionResponse(BaseModel):
    ticker_code: str
    ticker_name: str
    direction: str
    probability: float
    investment_opinion: str
    close_price: Optional[int] = None
    rsi_14: Optional[float] = None
    macd_hist: Optional[float] = None
    volume_ratio: Optional[float] = None
    sentiment_score: Optional[float] = None
    sentiment_summary: Optional[str] = None
    analyst_comment: Optional[str] = None
    generated_at: str
