#!/usr/bin/env python3
"""ดาวน์โหลดไลบรารีที่เกมต้องใช้ไว้ในโฟลเดอร์ vendor/ (ทำครั้งเดียว ใช้ได้แม้เน็ตบล็อก CDN ภายหลัง)
วิธีใช้:  python3 download-libs.py
"""
import os, sys, urllib.request

BASE = "https://cdn.jsdelivr.net/npm/"
FILES = {
    "vendor/three.min.js": "three@0.160.0/build/three.min.js",
    "vendor/supabase.js": "@supabase/supabase-js@2/dist/umd/supabase.js",
    "vendor/mediapipe/camera_utils/camera_utils.js": "@mediapipe/camera_utils@0.3.1675466862/camera_utils.js",
}
HANDS = "@mediapipe/hands@0.4.1675469240/"
for f in ["hands.js", "hands.binarypb", "hands_solution_packed_assets.data",
          "hands_solution_packed_assets_loader.js", "hands_solution_simd_wasm_bin.js",
          "hands_solution_simd_wasm_bin.wasm", "hands_solution_wasm_bin.js",
          "hands_solution_wasm_bin.wasm", "hand_landmark_full.tflite", "hand_landmark_lite.tflite"]:
    FILES["vendor/mediapipe/hands/" + f] = HANDS + f

here = os.path.dirname(os.path.abspath(__file__))
fail = 0
for dest, src in FILES.items():
    path = os.path.join(here, dest)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        print("ดาวน์โหลด", dest, "...", end=" ", flush=True)
        with urllib.request.urlopen(BASE + src, timeout=60) as r, open(path, "wb") as out:
            out.write(r.read())
        print("OK")
    except Exception as e:
        fail += 1
        print("ล้มเหลว:", e)
print("เสร็จสิ้น" if not fail else "มี %d ไฟล์ที่ดาวน์โหลดไม่สำเร็จ (ลองใหม่เมื่อเน็ตดีขึ้น)" % fail)
sys.exit(1 if fail else 0)
