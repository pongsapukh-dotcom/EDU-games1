/* EduGame common helpers (v9)
 * ใช้ร่วมกันทุกเกม เพื่อให้ตัวเลือกคำตอบแสดงผลเหมือนกัน:
 *   - ใส่แต่ข้อความ        -> แสดงข้อความ
 *   - ใส่แต่รูป            -> แสดงรูป
 *   - ใส่ทั้งรูปและข้อความ  -> แสดงรูป และมีข้อความอยู่ใต้ภาพ
 */
(function (global) {
  "use strict";

  var ROUND_SECONDS = 15;

  function escapeHTML(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function normalizeAnswer(a) {
    if (a && typeof a === "object") {
      return {
        text: String(a.text != null ? a.text : (a.label != null ? a.label : (a.word != null ? a.word : ""))).trim(),
        image_url: String(a.image_url || a.imageUrl || "")
      };
    }
    return { text: String(a == null ? "" : a).trim(), image_url: "" };
  }

  // รูปแบบการแสดงผลของตัวเลือก: "text" | "image" | "both"
  function answerMode(a) {
    var n = normalizeAnswer(a);
    if (n.image_url && n.text) return "both";
    if (n.image_url) return "image";
    return "text";
  }

  // รองรับข้อมูลเดิม (answers เป็น string) และข้อมูลใหม่ (answers เป็น object)
  function normalizeQuestion(q) {
    q = q || {};
    var answers = (Array.isArray(q.answers) ? q.answers : []).map(normalizeAnswer).slice(0, 4);
    while (answers.length < 4) answers.push({ text: "", image_url: "" });
    var correct = Number.isInteger(q.correct) ? q.correct : 0;
    if (correct < 0 || correct > 3) correct = 0;
    return {
      question: String(q.question || ""),
      image_url: String(q.image_url || q.imageUrl || ""),
      answers: answers,
      correct: correct,
      time_limit: ROUND_SECONDS
    };
  }

  // ชุดคำถามตัวอย่าง ใช้เมื่อเปิดเกมโดยตรงโดยยังไม่มีชุดคำถามส่งมาจากหน้าหลัก
  function defaultQuestions() {
    return normalizeQuestions([
      { question: "ข้อใดเป็นคำกริยา?", answers: ["วิ่ง", "โรงเรียน", "โต๊ะ", "หนังสือ"], correct: 0 },
      { question: "ข้อใดเป็นคำนาม?", answers: ["กิน", "แมว", "เดิน", "นอน"], correct: 1 },
      { question: "เมืองหลวงของประเทศไทยคือข้อใด?", answers: ["เชียงใหม่", "ภูเก็ต", "กรุงเทพมหานคร", "ขอนแก่น"], correct: 2 },
      { question: "5 + 3 = ?", answers: ["6", "7", "9", "8"], correct: 3 },
      { question: "ข้อใดเป็นสัตว์น้ำ?", answers: ["ปลา", "ช้าง", "นก", "ม้า"], correct: 0 }
    ]);
  }

  function normalizeQuestions(list) {
    return (Array.isArray(list) ? list : []).map(normalizeQuestion);
  }

  /* ---------- รูปภาพ (cache) ---------- */
  var imageCache = new Map();
  function getImage(url) {
    if (!url) return null;
    if (imageCache.has(url)) return imageCache.get(url);
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    imageCache.set(url, img);
    return img;
  }
  function preloadQuestions(questions) {
    (questions || []).forEach(function (q) {
      if (q.image_url) getImage(q.image_url);
      (q.answers || []).forEach(function (a) { if (a.image_url) getImage(a.image_url); });
    });
  }

  /* ---------- DOM: สร้างการ์ดตัวเลือก ---------- */
  function buildAnswerEl(a, opts) {
    opts = opts || {};
    var n = normalizeAnswer(a);
    var mode = answerMode(n);
    var el = document.createElement("div");
    el.className = "eg-answer eg-" + mode + (opts.className ? " " + opts.className : "");
    if (n.image_url) {
      var img = document.createElement("img");
      img.src = n.image_url;
      img.alt = n.text || "รูปตัวเลือก";
      img.draggable = false;
      el.appendChild(img);
    }
    if (n.text) {
      var span = document.createElement("span");
      span.className = "eg-answer-text";
      span.textContent = n.text; // textContent กัน HTML ฝังตัว
      el.appendChild(span);
    }
    return el;
  }

  /* ---------- Canvas: วาดการ์ดตัวเลือก ----------
   * วาดที่ศูนย์กลาง (cx, cy) ขนาดกล่อง w x h
   * คืนค่าขนาดจริงที่วาด {w,h}
   */
  function roundRectPath(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // ลดขนาดตัวอักษรลงจนพอดีความกว้าง
  function fitText(ctx, text, maxW, size, family, minSize) {
    var s = size;
    ctx.font = "700 " + s + "px " + family;
    while (ctx.measureText(text).width > maxW && s > (minSize || 10)) {
      s -= 1;
      ctx.font = "700 " + s + "px " + family;
    }
    return s;
  }

  function drawCover(ctx, img, x, y, w, h) {
    var iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
    var scale = Math.max(w / iw, h / ih);
    var dw = iw * scale, dh = ih * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function drawAnswerCard(ctx, a, cx, cy, o) {
    o = o || {};
    var n = normalizeAnswer(a);
    var mode = answerMode(n);
    var imgW = o.imageSize || 84;
    var textH = 30;
    var font = o.font || "Prompt, Mitr, sans-serif";
    var fill = o.fill || "rgba(8,20,40,.92)";
    var stroke = o.stroke || "rgba(255,255,255,.8)";
    var textColor = o.textColor || "#fff";
    var pad = 6;
    var maxTextW = o.maxTextWidth || 170;

    var w, h;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (mode === "text") {
      ctx.font = "700 " + (o.fontSize || 16) + "px " + font;
      var tw = Math.min(maxTextW, Math.max(o.minWidth || 70, ctx.measureText(n.text).width + 26));
      w = tw; h = o.textOnlyHeight || 34;
      roundRectPath(ctx, cx - w / 2, cy - h / 2, w, h, 10);
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = o.lineWidth || 2; ctx.strokeStyle = stroke; ctx.stroke();
      fitText(ctx, n.text, w - 14, o.fontSize || 16, font, 10);
      ctx.fillStyle = textColor;
      ctx.fillText(n.text, cx, cy + 1);
    } else {
      var hasText = mode === "both";
      w = imgW + pad * 2;
      h = imgW + pad * 2 + (hasText ? textH : 0);
      var top = cy - h / 2;
      roundRectPath(ctx, cx - w / 2, top, w, h, 12);
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = o.lineWidth || 2; ctx.strokeStyle = stroke; ctx.stroke();
      // รูป
      var img = getImage(n.image_url);
      ctx.save();
      roundRectPath(ctx, cx - imgW / 2, top + pad, imgW, imgW, 8);
      ctx.clip();
      if (img && img.complete && img.naturalWidth) {
        drawCover(ctx, img, cx - imgW / 2, top + pad, imgW, imgW);
      } else {
        ctx.fillStyle = "rgba(255,255,255,.12)";
        ctx.fillRect(cx - imgW / 2, top + pad, imgW, imgW);
      }
      ctx.restore();
      // ข้อความ "ใต้ภาพ"
      if (hasText) {
        var ty = top + pad + imgW + textH / 2;
        fitText(ctx, n.text, w - 12, o.fontSize || 15, font, 10);
        ctx.fillStyle = textColor;
        ctx.fillText(n.text, cx, ty);
      }
    }
    ctx.restore();
    return { w: w, h: h, mode: mode };
  }

  /* ---------- สื่อสารกับหน้าหลัก ---------- */
  function post(type, payload) {
    try {
      if (global.parent && global.parent !== global) global.parent.postMessage({ type: type, payload: payload }, "*");
    } catch (e) { /* ignore */ }
  }
  var lastScore = null;
  function reportScore(score, extra) {
    if (score === lastScore && !extra) return;
    lastScore = score;
    post("EDUGAME_SCORE", Object.assign({ score: score }, extra || {}));
  }

  // กด F ในเกม (โฟกัสอยู่ใน iframe) -> ขอให้หน้าหลักสลับเต็มจอ
  global.addEventListener("keydown", function (e) {
    if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) post("EDUGAME_TOGGLE_FULLSCREEN");
  });

  global.EduCommon = {
    ROUND_SECONDS: ROUND_SECONDS,
    escapeHTML: escapeHTML,
    normalizeAnswer: normalizeAnswer,
    normalizeQuestion: normalizeQuestion,
    normalizeQuestions: normalizeQuestions,
    defaultQuestions: defaultQuestions,
    answerMode: answerMode,
    getImage: getImage,
    preloadQuestions: preloadQuestions,
    buildAnswerEl: buildAnswerEl,
    drawAnswerCard: drawAnswerCard,
    roundRectPath: roundRectPath,
    post: post,
    reportScore: reportScore
  };
})(window);
