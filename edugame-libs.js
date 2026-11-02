/* EduGame library loader (v10)
 * โหลดไลบรารีภายนอก (three.js / MediaPipe Hands / Camera) แบบมีตัวสำรอง:
 *   1) ไฟล์ในเครื่องที่โฟลเดอร์ vendor/  (ดูวิธีดาวน์โหลดใน README.txt)
 *   2) jsDelivr  3) unpkg
 * ถ้าโหลดไม่ได้ เกมจะไม่ค้าง แต่แจ้งผู้เล่นและสลับไปโหมดเมาส์/สัมผัส
 */
(function (global) {
  "use strict";

  var LIBS = {
    three: {
      test: function () { return !!global.THREE; },
      srcs: [
        "vendor/three.min.js",
        "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js",
        "https://unpkg.com/three@0.160.0/build/three.min.js"
      ]
    },
    camera: {
      test: function () { return typeof global.Camera === "function"; },
      srcs: [
        "vendor/mediapipe/camera_utils/camera_utils.js",
        "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js",
        "https://unpkg.com/@mediapipe/camera_utils/camera_utils.js"
      ]
    },
    hands: {
      test: function () { return typeof global.Hands === "function"; },
      srcs: [
        "vendor/mediapipe/hands/hands.js",
        "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js",
        "https://unpkg.com/@mediapipe/hands/hands.js"
      ]
    }
  };

  var pending = {};   // name -> Promise
  var usedSrc = {};   // name -> src ที่โหลดสำเร็จ

  function inject(src, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      var done = false;
      var timer = setTimeout(function () { fail(new Error("timeout " + src)); }, timeoutMs || 20000);
      function fail(err) { if (done) return; done = true; clearTimeout(timer); s.remove(); reject(err); }
      s.onload = function () { if (done) return; done = true; clearTimeout(timer); resolve(src); };
      s.onerror = function () { fail(new Error("load error " + src)); };
      s.src = src;
      document.head.appendChild(s);
    });
  }

  function load(name) {
    var lib = LIBS[name];
    if (!lib) return Promise.reject(new Error("unknown lib " + name));
    if (lib.test()) return Promise.resolve(true);
    if (pending[name]) return pending[name];
    var p = lib.srcs.reduce(function (chain, src) {
      return chain.catch(function () {
        return inject(src).then(function (s) {
          if (!lib.test()) throw new Error("loaded but not ready " + s);
          usedSrc[name] = s;
          return true;
        });
      });
    }, Promise.reject(new Error("start")));
    pending[name] = p.catch(function (e) {
      delete pending[name]; // ให้ลองใหม่ได้ภายหลัง
      throw new Error("โหลดไลบรารี " + name + " ไม่สำเร็จ");
    });
    return pending[name];
  }

  function loadAll(names) { return Promise.all(names.map(load)); }

  // โฟลเดอร์ที่ใช้เก็บไฟล์ของ MediaPipe Hands (wasm / model) ตามที่ hands.js ถูกโหลดมา
  function handsBase() {
    var s = usedSrc.hands || LIBS.hands.srcs[1];
    return s.replace(/hands\.js$/, "");
  }

  /* ตรวจว่าเบราว์เซอร์ใช้กล้องได้หรือไม่ คืนค่า "" ถ้าใช้ได้ หรือข้อความอธิบายสาเหตุ */
  function cameraProblem() {
    // กล้องใน iframe ต้องได้รับอนุญาตจาก Permissions Policy ของหน้าแม่ด้วย
    try {
      var policy = document.permissionsPolicy || document.featurePolicy;
      if (policy && typeof policy.allowsFeature === "function" && !policy.allowsFeature("camera")) {
        return "หน้าเว็บไซต์หรือ iframe ถูกปิดสิทธิ์กล้องโดย Permissions Policy — ผู้ดูแลเว็บไซต์ต้องอนุญาต camera ให้หน้าเกม";
      }
    } catch (_) {}
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (global.isSecureContext === false) {
        return "เบราว์เซอร์ปิดการใช้กล้องเพราะหน้านี้ไม่ใช่ HTTPS/localhost (เช่น เปิดด้วย http://192.168.x.x) — ให้เปิดผ่าน https:// หรือ http://localhost";
      }
      return "เบราว์เซอร์นี้ไม่รองรับการใช้กล้อง";
    }
    return "";
  }

  function explainCameraError(e) {
    var n = e && e.name;
    if (n === "NotAllowedError" || n === "SecurityError") return "เบราว์เซอร์หรือ Permissions Policy ไม่อนุญาตกล้อง (ตรวจสิทธิ์กล้องของเว็บไซต์ และสิทธิ์ camera ของ iframe)";
    if (n === "NotFoundError" || n === "OverconstrainedError") return "ไม่พบกล้องในอุปกรณ์นี้";
    if (n === "NotReadableError") return "กล้องถูกโปรแกรมอื่นใช้งานอยู่ ปิดโปรแกรมนั้นแล้วลองใหม่";
    if (n === "CameraTimeout") return "เปิดกล้องแล้วแต่ไม่มีภาพส่งมา (กล้องอาจถูกแอปอื่นใช้อยู่ หรือเบราว์เซอร์ปิดภาพไว้) ลองปิดแท็บ/แอปอื่นที่ใช้กล้อง แล้วโหลดหน้าใหม่";
    if (n === "AbortError") return "เบราว์เซอร์ยกเลิกการเปิดกล้อง ลองกดใหม่อีกครั้ง";
    return (e && e.message) || "เปิดกล้องไม่สำเร็จ";
  }

  /* ขอสตรีมกล้อง (ลองความละเอียดสูงก่อน แล้วลดลงถ้าไม่ได้) */
  function getCameraStream() {
    var problem = cameraProblem();
    if (problem) return Promise.reject(Object.assign(new Error(problem), { name: "SecurityError", custom: true }));
    var tries = [
      { video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: "user" }, audio: false },
      { video: true, audio: false }
    ];
    return tries.reduce(function (chain, c) {
      return chain.catch(function (err) {
        if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) throw err;
        return navigator.mediaDevices.getUserMedia(c);
      });
    }, Promise.reject(Object.assign(new Error("start"), { name: "Start" })));
  }


  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error("timeout " + label)); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  /* เปิดกล้องครั้งเดียว ผูกกับ <video> แล้วรอจนมีภาพจริง
   * คืน { stream, stop() } — ไม่ใช้ Camera ของ MediaPipe (มันขอกล้องซ้ำและทับสตรีมเดิม) */
  function openCamera(video) {
    var stream = null, endedCbs = [];
    function stop() {
      endedCbs = [];
      if (stream) { stream.getTracks().forEach(function (t) { t.onended = null; t.stop(); }); stream = null; }
      try { video.srcObject = null; } catch (_) {}
    }
    return getCameraStream().then(function (s) {
      stream = s;
      video.muted = true;
      video.autoplay = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.srcObject = s;
      // กล้องหลุดกลางเกม (ถอดสาย / ระบบตัดกล้อง) -> แจ้งให้เกมสลับโหมดเมาส์
      s.getTracks().forEach(function (t) {
        t.onended = function () { var cbs = endedCbs.slice(); cbs.forEach(function (f) { try { f(); } catch (_) {} }); };
      });
      var p = video.play();
      return p && p.catch ? p.catch(function () { /* autoplay จะเล่นเองเมื่อมีเฟรม */ }) : p;
    }).then(function () {
      return withTimeout(new Promise(function (resolve) {
        if (video.videoWidth > 0) return resolve();
        video.addEventListener("loadeddata", function f() { video.removeEventListener("loadeddata", f); resolve(); });
      }), 8000, "camera frames").catch(function () {
        throw Object.assign(new Error("camera produced no frames"), { name: "CameraTimeout" });
      });
    }).then(function () {
      return { stream: stream, stop: stop, onEnded: function (cb) { endedCbs.push(cb); } };
    }, function (err) {
      stop();
      throw err;
    });
  }

  /* โหลดโมเดลมือล่วงหน้า เพื่อรู้ทันทีถ้าไฟล์ wasm/model โหลดไม่ได้ */
  function initHands(hands, ms) {
    if (typeof hands.initialize !== "function") return Promise.resolve();
    return withTimeout(Promise.resolve(hands.initialize()), ms || 60000, "hands model");
  }

  /* วนส่งเฟรมจาก <video> เข้า MediaPipe Hands ทีละเฟรม
   * opts.onFatal(err) ถูกเรียกถ้าส่งเฟรมพลาดติดกัน 5 ครั้ง */
  function trackHands(video, hands, opts) {
    opts = opts || {};
    var stopped = false, busy = false, fails = 0, lastOk = Date.now();
    function fatal(e) { if (stopped) return; stopped = true; clearInterval(wd); if (opts.onFatal) opts.onFatal(e); }
    function schedule() {
      if (stopped) return;
      if (typeof video.requestVideoFrameCallback === "function") video.requestVideoFrameCallback(tick);
      else requestAnimationFrame(tick);
    }
    function tick() {
      if (stopped) return;
      if (busy || video.readyState < 2 || !video.videoWidth) return schedule();
      busy = true;
      Promise.resolve(hands.send({ image: video })).then(function () { fails = 0; lastOk = Date.now(); }, function (e) {
        if (++fails >= 5) fatal(e);
      }).then(function () { busy = false; schedule(); });
    }
    // ถ้าไม่มีเฟรมเข้า AI นานเกิน 8 วินาที (กล้องค้าง/ภาพหยุด) ให้ถือว่าล้มเหลว — ไม่นับตอนแท็บถูกซ่อน
    var wd = setInterval(function () {
      if (document.hidden) { lastOk = Date.now(); return; }
      if (Date.now() - lastOk > 8000) fatal(new Error("camera stalled"));
    }, 1000);
    schedule();
    return { stop: function () { stopped = true; clearInterval(wd); } };
  }

  /* แปลงพิกัดมือ (0..1 ในภาพกล้อง) เป็นพิกัดบนจอ โดยคิดทั้ง
   *  - การกลับด้านภาพ (CSS scaleX(-1)) เมื่อ mirror !== false
   *  - object-fit: cover (ภาพถูกครอบตัด) เมื่อ fit = "cover" (ค่าเริ่มต้น); ใช้ "fill" ถ้า video ยืดเต็มจอ */
  function mapPoint(video, nx, ny, W, H, opts) {
    opts = opts || {};
    var vw = video.videoWidth || 0, vh = video.videoHeight || 0;
    var x = nx * W, y = ny * H;
    if ((opts.fit || "cover") === "cover" && vw && vh) {
      var s = Math.max(W / vw, H / vh), dw = vw * s, dh = vh * s;
      x = nx * dw + (W - dw) / 2;
      y = ny * dh + (H - dh) / 2;
    }
    if (opts.mirror !== false) x = W - x;
    return { x: x, y: y };
  }

  global.EduLibs = {
    load: load,
    loadAll: loadAll,
    handsBase: handsBase,
    cameraProblem: cameraProblem,
    explainCameraError: explainCameraError,
    getCameraStream: getCameraStream,
    openCamera: openCamera,
    initHands: initHands,
    trackHands: trackHands,
    mapPoint: mapPoint
  };
})(window);
