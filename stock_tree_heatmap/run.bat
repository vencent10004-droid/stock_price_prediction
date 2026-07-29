@echo off
chcp 65001 >nul
cd /d %~dp0
echo [1/2] 필요한 패키지 설치 확인...
pip install -r requirements.txt -q
echo [2/2] 서버 시작 (브라우저가 자동으로 열립니다)
python app.py
pause
