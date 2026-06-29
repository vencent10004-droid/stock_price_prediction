"""Google Gemini REST API로 뉴스 감성 분석 및 애널리스트 코멘트 생성"""

import os
import json
import logging
import requests

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"


def _call_gemini(prompt: str, timeout: int = 60, retries: int = 2) -> str:
    """Gemini REST API 호출 → 텍스트 반환 (타임아웃 시 재시도)"""
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key or "여기에" in api_key:
        return ""

    for attempt in range(retries + 1):
        try:
            resp = requests.post(
                GEMINI_URL,
                params={"key": api_key},
                json={"contents": [{"parts": [{"text": prompt}]}]},
                timeout=timeout,
            )
            resp.raise_for_status()
            data = resp.json()
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except requests.exceptions.Timeout:
            logger.warning(f"Gemini 타임아웃 (시도 {attempt + 1}/{retries + 1})")
            continue
        except Exception as e:
            logger.error(f"Gemini API 호출 실패: {e}")
            return ""
    logger.error("Gemini API 호출 실패: 모든 재시도 타임아웃")
    return ""


def analyze_sentiment(ticker_name: str, headlines: list[str]) -> dict:
    """뉴스 헤드라인 감성 분석"""
    if not headlines:
        return {"score": 0.0, "positive": 0, "neutral": 0, "negative": 0,
                "news_count": 0, "summary": "뉴스 없음"}

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key or "여기에" in api_key:
        return {"score": 0.0, "positive": 0, "neutral": 0, "negative": 0,
                "news_count": 0, "summary": "API 키 미설정"}

    titles = [h["title"] if isinstance(h, dict) else h for h in headlines]
    headlines_text = "\n".join(f"{i+1}. {t}" for i, t in enumerate(titles))
    prompt = f"""아래는 {ticker_name} 관련 오늘 뉴스 헤드라인입니다.
각 헤드라인을 긍정(+1), 중립(0), 부정(-1)으로 분류하고,
전체 감성 점수(-1.0 ~ +1.0)와 한 줄 요약을 JSON으로 반환하세요.

헤드라인:
{headlines_text}

반드시 아래 JSON 형식만 반환하세요 (설명 없이):
{{
  "items": [{{"headline": "...", "score": 1}}],
  "overall_score": 0.3,
  "summary": "전반적으로 긍정적인 뉴스가 우세합니다."
}}"""

    raw = _call_gemini(prompt)
    if not raw:
        return {"score": 0.0, "positive": 0, "neutral": 0, "negative": 0,
                "news_count": 0, "summary": "분석 실패"}

    try:
        if "```" in raw:
            raw = raw.split("```")[1].replace("json", "").strip()
        data = json.loads(raw)
        items = data.get("items", [])
        return {
            "score": float(data.get("overall_score", 0.0)),
            "positive": sum(1 for it in items if it.get("score", 0) > 0),
            "neutral":  sum(1 for it in items if it.get("score", 0) == 0),
            "negative": sum(1 for it in items if it.get("score", 0) < 0),
            "news_count": len(items),
            "summary": data.get("summary", ""),
        }
    except Exception as e:
        logger.error(f"감성 JSON 파싱 실패: {e} / raw: {raw[:100]}")
        return {"score": 0.0, "positive": 0, "neutral": 0, "negative": 0,
                "news_count": 0, "summary": "분석 실패"}


def generate_analyst_comment(ticker_name: str, prediction: dict,
                              indicators: dict, sentiment: dict) -> str:
    """애널리스트 코멘트 생성 (Gemini 실패 시 규칙 기반 폴백)"""
    direction = prediction.get("direction", "N/A")
    prob = prediction.get("probability", 0) * 100
    opinion = prediction.get("investment_opinion", "N/A")

    prompt = f"""당신은 전문 주식 애널리스트입니다. 아래 데이터를 바탕으로
{ticker_name}에 대한 내일 주가 전망 코멘트를 3~4문장으로 작성하세요.
전문적이고 간결하게, 투자자에게 유용한 인사이트를 제공하세요.

[예측 결과]
- 방향: {direction} ({prob:.1f}% 신뢰도)
- 투자의견: {opinion}

[기술적 지표]
- RSI(14): {indicators.get('rsi_14', 'N/A')}
- MACD Hist: {indicators.get('macd_hist', 'N/A')}
- 거래량 비율: {indicators.get('volume_ratio', 'N/A')}

[뉴스 감성]
- 감성 점수: {sentiment.get('score', 0):.2f}
- 요약: {sentiment.get('summary', '없음')}

마지막 문장은 반드시 "본 의견은 참고용이며 투자 손실의 책임은 투자자 본인에게 있습니다."로 끝내세요."""

    result = _call_gemini(prompt)
    if result:
        return result
    return _rule_based_comment(ticker_name, prediction, indicators, sentiment)


def _rule_based_comment(ticker_name: str, prediction: dict,
                         indicators: dict, sentiment: dict) -> str:
    direction = prediction.get("direction", "N/A")
    prob = prediction.get("probability", 0) * 100
    opinion = prediction.get("investment_opinion", "중립")
    rsi = indicators.get("rsi_14", 50)
    vol = indicators.get("volume_ratio", 1.0)
    sent_score = sentiment.get("score", 0)

    rsi_msg = (f"RSI({rsi:.1f})는 과매수 구간으로 단기 조정 가능성에 유의가 필요합니다." if rsi > 70
               else f"RSI({rsi:.1f})는 과매도 구간으로 반등 가능성이 있습니다." if rsi < 30
               else f"RSI({rsi:.1f})는 중립 구간에 위치합니다.")
    vol_msg = (f"거래량이 평균 대비 {vol:.1f}배로 강한 수급이 확인됩니다." if vol > 1.5
               else f"거래량이 평균 대비 {vol:.1f}배로 거래가 한산합니다." if vol < 0.7
               else "거래량은 평균 수준입니다.")
    sent_msg = ("뉴스 감성은 긍정적으로 투자 심리에 우호적입니다." if sent_score > 0.1
                else "뉴스 감성은 부정적으로 리스크 관리가 필요합니다." if sent_score < -0.1
                else "뉴스 감성은 중립적입니다.")

    return (f"AI 모델은 {ticker_name}의 내일 주가를 {direction}({prob:.1f}% 신뢰도)으로 예측하며 "
            f"투자의견은 '{opinion}'입니다. {rsi_msg} {vol_msg} {sent_msg} "
            f"본 의견은 참고용이며 투자 손실의 책임은 투자자 본인에게 있습니다.")
