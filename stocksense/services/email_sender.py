"""Gmail SMTP 이메일 발송 (HTML + PDF 첨부)"""

import smtplib
import os
import logging
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)


def send_report(
    pdf_path: str,
    ticker_name: str,
    prediction: dict,
    sentiment: dict,
    recipients: list[str] = None,
) -> bool:
    """PDF 리포트를 이메일로 발송. 성공 시 True 반환."""
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    sender = os.getenv("EMAIL_SENDER", "")
    password = os.getenv("EMAIL_PASSWORD", "")
    if not recipients:
        env_rcpt = os.getenv("EMAIL_RECIPIENTS", "")
        recipients = [r.strip() for r in env_rcpt.split(",") if r.strip()]

    if not sender or not password:
        logger.warning("이메일 설정 없음 (EMAIL_SENDER / EMAIL_PASSWORD) → 발송 건너뜀")
        return False
    if not recipients:
        logger.warning("수신자 목록 없음 → 발송 건너뜀")
        return False

    direction = prediction.get("direction", "N/A")
    prob = prediction.get("probability", 0)
    opinion = prediction.get("investment_opinion", "N/A")
    sent_score = sentiment.get("score", 0)
    today = datetime.now().strftime("%Y년 %m월 %d일")

    subject = f"[StockSense] {ticker_name} {today} 예측 리포트 - {direction} ({prob*100:.0f}%)"

    dir_color = "#EF4444" if direction == "상승" else "#3B82F6"
    html = f"""
<html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
<div style="background:#1E40AF;color:white;padding:20px;border-radius:8px 8px 0 0;">
  <h2 style="margin:0">📊 StockSense Daily Report</h2>
  <p style="margin:4px 0;opacity:0.8">{today} | {ticker_name}</p>
</div>
<div style="border:1px solid #E5E7EB;padding:20px;border-radius:0 0 8px 8px;">
  <table width="100%" style="border-collapse:collapse;margin-bottom:16px;">
    <tr>
      <td style="padding:10px;background:#F0F9FF;font-weight:bold;width:120px">내일 방향</td>
      <td style="padding:10px;color:{dir_color};font-weight:bold;font-size:1.2em">{direction}</td>
    </tr>
    <tr>
      <td style="padding:10px;background:#F0F9FF;font-weight:bold">신뢰도</td>
      <td style="padding:10px">{prob*100:.1f}%</td>
    </tr>
    <tr>
      <td style="padding:10px;background:#F0F9FF;font-weight:bold">투자의견</td>
      <td style="padding:10px"><strong>{opinion}</strong></td>
    </tr>
    <tr>
      <td style="padding:10px;background:#F0F9FF;font-weight:bold">뉴스 감성</td>
      <td style="padding:10px">{sent_score:+.2f} ({sentiment.get('summary', '')})</td>
    </tr>
  </table>
  <p style="font-size:12px;color:#6B7280;margin-top:20px;border-top:1px solid #E5E7EB;padding-top:12px">
    ※ 본 리포트는 AI 모델에 의한 자동 생성 자료입니다. 투자 손실의 책임은 투자자 본인에게 있습니다.
  </p>
</div>
</body></html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(html, "html", "utf-8"))

    # PDF 첨부
    if pdf_path and Path(pdf_path).exists():
        with open(pdf_path, "rb") as f:
            pdf_part = MIMEApplication(f.read(), _subtype="pdf")
            pdf_part.add_header("Content-Disposition", "attachment",
                                filename=Path(pdf_path).name)
            msg.attach(pdf_part)

    # 재시도 3회
    for attempt in range(3):
        try:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
                server.ehlo()
                server.starttls()
                server.login(sender, password)
                server.sendmail(sender, recipients, msg.as_string())
            logger.info(f"이메일 발송 완료 → {recipients}")
            return True
        except Exception as e:
            logger.warning(f"이메일 발송 실패 ({attempt+1}/3): {e}")
            if attempt < 2:
                time.sleep(5)
    return False
