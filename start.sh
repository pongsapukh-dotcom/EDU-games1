#!/usr/bin/env bash
# เปิดเว็บ EduGame ที่ http://localhost:8000 (ใช้กล้องได้)
cd "$(dirname "$0")"
PORT=${1:-8000}
echo "เปิดที่ http://localhost:$PORT  (กด Ctrl+C เพื่อหยุด)"
( sleep 1; (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT") || (command -v open >/dev/null && open "http://localhost:$PORT") ) >/dev/null 2>&1 &
if command -v python3 >/dev/null; then python3 -m http.server "$PORT"; else python -m http.server "$PORT"; fi
