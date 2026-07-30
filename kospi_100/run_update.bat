@echo off
rem KOSPI 100 대시보드 자동 업데이트 (작업 스케줄러에서 매일 호출)
cd /d "%~dp0"
"C:\Users\user\AppData\Local\Programs\Python\Python312\python.exe" update_dashboard.py >> update_log.txt 2>&1
