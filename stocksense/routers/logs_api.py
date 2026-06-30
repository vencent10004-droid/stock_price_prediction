"""실행 로그 조회 API (UI 실행 로그 화면 SCR-04)"""

import re
from pathlib import Path
from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["logs"])

LOG_PATH = Path(__file__).parent.parent / "logs" / "app.log"
_LINE = re.compile(r"^(?P<time>[\d\-]+\s[\d:,]+)\s\[(?P<level>\w+)\]\s(?P<name>[^:]+):\s(?P<msg>.*)$")


@router.get("/logs")
def get_logs(lines: int = 100):
    """최근 로그 N줄을 구조화해 반환 (최신순)."""
    if not LOG_PATH.exists():
        return {"records": [], "total": 0}

    with open(LOG_PATH, encoding="utf-8", errors="replace") as f:
        raw = f.readlines()[-lines:]

    records = []
    for ln in raw:
        m = _LINE.match(ln.rstrip("\n"))
        if m:
            records.append({
                "time": m.group("time")[:19],
                "level": m.group("level"),
                "name": m.group("name").split(".")[-1],
                "msg": m.group("msg"),
            })
        elif ln.strip():  # 멀티라인(스택트레이스 등)은 직전 메시지에 덧붙임
            if records:
                records[-1]["msg"] += " " + ln.strip()

    records.reverse()  # 최신이 위로
    return {"records": records, "total": len(records)}
