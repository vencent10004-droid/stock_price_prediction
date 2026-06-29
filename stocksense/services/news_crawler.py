"""네이버 모바일 주식 뉴스 API로 헤드라인 수집 (회사 관련성 우선 정렬)"""

import requests
import logging

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Linux; Android 10; SM-G981B) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/80.0.3987.162 Mobile Safari/537.36"
    ),
    "Referer": "https://m.stock.naver.com/",
}


def _relevance(text: str, keywords: list[str]) -> int:
    """텍스트에 종목 관련 키워드가 몇 개 포함되는지 점수화"""
    if not text:
        return 0
    return sum(1 for kw in keywords if kw and kw in text)


def _build_keywords(ticker_name: str) -> list[str]:
    """종목명에서 관련 키워드 생성 (예: '삼성전자' → ['삼성전자', '삼성'])"""
    kws = []
    if ticker_name:
        name = ticker_name.strip()
        kws.append(name)
        # '삼성전자' → '삼성', 'SK하이닉스' → 'SK하이닉스'(2글자 미만 제외)
        if len(name) >= 4:
            kws.append(name[:2])
    return kws


def fetch_naver_news(ticker_code: str, ticker_name: str = "",
                     max_articles: int = 10) -> list[dict]:
    """네이버 모바일 주식 뉴스 API로 헤드라인 수집.

    반환: [{"title": str, "url": str}, ...]
    종목명이 제목/본문에 포함된 기사를 우선 정렬한다.
    """
    # 관련성 필터링을 위해 넉넉히 수집
    fetch_size = max(max_articles * 3, 30)
    url = (f"https://m.stock.naver.com/api/news/stock/{ticker_code}"
           f"?pageSize={fetch_size}&page=0")
    keywords = _build_keywords(ticker_name)
    collected = []
    seen = set()

    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        # 응답 구조: [{"total":N,"items":[뉴스, ...]}, ...]
        items = []
        if isinstance(data, list):
            for wrapper in data:
                if isinstance(wrapper, dict):
                    items.extend(wrapper.get("items", []))
        elif isinstance(data, dict):
            items = data.get("items", data.get("news", []))

        for item in items:
            title = (item.get("title") or item.get("titleFull") or "").strip()
            if not title or len(title) <= 5 or title in seen:
                continue
            seen.add(title)

            link = (item.get("mobileNewsUrl") or "").strip()
            if not link:
                office_id = item.get("officeId", "")
                article_id = item.get("articleId", "")
                if office_id and article_id:
                    link = f"https://n.news.naver.com/mnews/article/{office_id}/{article_id}"

            body = item.get("body", "")
            score = _relevance(title, keywords) * 2 + _relevance(body, keywords)
            collected.append({"title": title, "url": link, "_score": score})

        # 관련성 높은 순으로 정렬 (동점은 원래 순서 = 최신순 유지)
        collected.sort(key=lambda x: x["_score"], reverse=True)
        result = [{"title": c["title"], "url": c["url"]}
                  for c in collected[:max_articles]]

        relevant = sum(1 for c in collected[:max_articles] if c["_score"] > 0)
        logger.info(f"{ticker_code} 뉴스 수집: {len(result)}개 "
                    f"(관련 {relevant}개 / 키워드 {keywords})")
        return result

    except Exception as e:
        logger.warning(f"뉴스 크롤링 실패 ({ticker_code}): {e}")
        return []
