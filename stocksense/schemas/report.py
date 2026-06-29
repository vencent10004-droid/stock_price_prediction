from pydantic import BaseModel
from typing import Optional


class PriceRangeBull(BaseModel):
    low: int
    high: int
    resistance1: int
    resistance2: int


class PriceRangeBear(BaseModel):
    low: int
    high: int
    support1: int
    support2: int


class ReportResponse(BaseModel):
    ticker_code: str
    ticker_name: str
    report_date: str
    pdf_path: Optional[str] = None
    prediction: dict
    price_range: dict
    sentiment: dict
    analyst_comment: str
