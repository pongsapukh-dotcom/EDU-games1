@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo เปิดที่ http://localhost:8000  (ปิดหน้าต่างนี้เพื่อหยุดเซิร์ฟเวอร์)
start "" http://localhost:8000
where py >nul 2>nul && (py -m http.server 8000 & goto :eof)
where python >nul 2>nul && (python -m http.server 8000 & goto :eof)
echo ไม่พบ Python กรุณาติดตั้งจาก https://www.python.org/downloads/ (ติ๊ก Add to PATH) แล้วลองใหม่
pause
