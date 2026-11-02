/* EduGame Realtime (v9)
 * ห้องเรียนเรียลไทม์ ใช้ Supabase Realtime "Broadcast" (ไม่ต้องสร้างตารางเพิ่ม)
 * ถ้ายังไม่ได้ตั้งค่า Supabase จะใช้ BroadcastChannel ของเบราว์เซอร์แทน
 * (ทดสอบได้เมื่อเปิดหลายแท็บในเครื่องเดียวกัน)
 */
(function (global) {
  "use strict";

  function genRoomCode() {
    var n = new Uint32Array(1);
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(n);
    else n[0] = Math.floor(Math.random() * 4294967295);
    return String(100000 + (n[0] % 900000)); // 6 หลัก เลขอารบิก
  }

  function isValidRoomCode(code) {
    return /^\d{6}$/.test(String(code || ""));
  }

  function uid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // ข้อความใหญ่ (เช่น ชุดคำถามที่มีรูปฝังในข้อมูล) จะถูกแบ่งเป็นชิ้นเล็ก ๆ แล้วส่งทีละชิ้น
  // เพื่อไม่ให้เกินขีดจำกัดขนาดข้อความและอัตราการส่งของ Realtime
  var CHUNK_SIZE = 40000;
  var SEND_GAP_MS = 120;

  // isOpen(): ช่องส่งพร้อมใช้งานไหม  ถ้าไม่พร้อมจะทิ้งข้อความที่ค้างคิว (ข้อความสถานะ/คะแนนถูกส่งซ้ำเป็นช่วง ๆ
  // และ hello/heartbeat จะซิงก์ให้ใหม่หลังต่อกลับได้ ดีกว่าส่งข้อความเก่าที่ตกค้างทีหลัง)
  function makeSender(rawSend, isOpen) {
    var queue = [], timer = null;
    function pump() {
      if (isOpen && !isOpen()) { queue.length = 0; timer = null; return; }
      if (!queue.length) { timer = null; return; }
      rawSend(queue.shift());
      timer = setTimeout(pump, SEND_GAP_MS);
    }
    return function (obj) {
      if (isOpen && !isOpen()) { queue.length = 0; return false; }
      var text = JSON.stringify(obj);
      if (text.length <= CHUNK_SIZE) {
        queue.push(obj);
      } else {
        var cid = uid(), n = Math.ceil(text.length / CHUNK_SIZE);
        for (var i = 0; i < n; i++) {
          queue.push({ t: "_chunk", cid: cid, i: i, n: n, d: text.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) });
        }
      }
      if (!timer) pump();
      return true;
    };
  }

  function makeReceiver(deliver) {
    var buffers = {};
    function sweep() {
      var now = Date.now();
      for (var k in buffers) if (now - buffers[k].at > 30000) delete buffers[k]; // ชิ้นส่วนที่ไม่มาครบ (เช่นเน็ตหลุดกลางทาง)
    }
    return function (msg) {
      if (!msg || typeof msg !== "object") return;
      if (msg.t !== "_chunk") { deliver(msg); return; }
      sweep();
      var b = buffers[msg.cid] || (buffers[msg.cid] = { n: msg.n, parts: [], got: 0, at: Date.now() });
      if (b.parts[msg.i] == null) { b.parts[msg.i] = msg.d; b.got++; }
      if (b.got === b.n) {
        delete buffers[msg.cid];
        try { deliver(JSON.parse(b.parts.join(""))); } catch (e) { /* ข้อมูลเสียหาย ข้ามไป */ }
      }
    };
  }

  /**
   * open({ code, client, onMessage, onStatus }) -> { send, close, reconnect, isConnected, transport }
   * onStatus: "connecting" | "connected" | "reconnecting" | "error"
   *   - "reconnecting" = หลุดแล้วกำลังต่อใหม่อัตโนมัติ (ลองซ้ำเรื่อย ๆ แบบถ่วงเวลา 1→2→4→8 วินาที)
   *   - "error" = ต่อครั้งแรกไม่สำเร็จเกิน FIRST_CONNECT_TIMEOUT_MS (ยังลองต่อใหม่ต่อไป ถ้าต่อได้จะส่ง "connected")
   *   onStatus("connected") อาจถูกเรียกหลายครั้ง (ทุกครั้งที่ต่อกลับ) ฝั่งที่เรียกต้องรองรับการเรียกซ้ำ
   */
  var FIRST_CONNECT_TIMEOUT_MS = 20000;
  var BACKOFF_MS = [1000, 2000, 4000, 8000];

  function open(opts) {
    var code = opts.code;
    var name = "edugame-room-" + code;
    var onStatus = opts.onStatus || function () {};
    var closed = false;
    var receive = makeReceiver(function (m) { if (!closed && opts.onMessage) opts.onMessage(m); });

    // ----- Supabase Realtime Broadcast -----
    if (opts.client && typeof opts.client.channel === "function") {
      var channel = null, connected = false, everConnected = false, attempt = 0, retryTimer = null, gen = 0, errorShown = false;

      var emit = function (st) { if (!closed) onStatus(st); };

      var scheduleRetry = function () {
        if (closed || retryTimer) return;
        var wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        attempt++;
        retryTimer = setTimeout(function () { retryTimer = null; if (!connected) connect(); }, wait);
      };

      var onDown = function (myGen) {
        if (closed || myGen !== gen) return;
        var wasConnected = connected;
        connected = false;
        if (wasConnected || everConnected) emit("reconnecting");
        scheduleRetry();
      };

      var connect = function () {
        if (closed) return;
        var myGen = ++gen;
        if (channel) { try { opts.client.removeChannel(channel); } catch (e) { /* ignore */ } channel = null; }
        try {
          channel = opts.client.channel(name, { config: { broadcast: { self: false, ack: false } } });
          channel
            .on("broadcast", { event: "m" }, function (msg) {
              if (!closed && myGen === gen && msg && msg.payload) receive(msg.payload);
            })
            .subscribe(function (status) {
              if (closed || myGen !== gen) return;
              if (status === "SUBSCRIBED") {
                var firstTime = !connected;
                connected = true; everConnected = true; attempt = 0;
                if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
                if (firstTime) emit("connected");
              } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
                onDown(myGen);
              }
            });
        } catch (e) { onDown(myGen); }
      };

      emit("connecting");
      connect();
      // ต่อครั้งแรกไม่สำเร็จนานเกินไป: แจ้ง error หนึ่งครั้ง (แต่ยังลองต่อใหม่ต่อไป)
      var firstTimer = setTimeout(function () {
        if (!closed && !everConnected && !errorShown) { errorShown = true; emit("error"); }
      }, FIRST_CONNECT_TIMEOUT_MS);

      // เน็ตกลับมา / กลับมาเปิดแท็บ: ลองต่อใหม่ทันทีถ้ายังไม่ได้ต่อ
      var wake = function () {
        if (closed || connected) return;
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        attempt = 0;
        connect();
      };
      var onVis = function () { if (!document.hidden) wake(); };
      if (global.addEventListener) global.addEventListener("online", wake);
      if (global.document && global.document.addEventListener) global.document.addEventListener("visibilitychange", onVis);

      return {
        transport: "supabase",
        isConnected: function () { return connected; },
        reconnect: wake,
        send: makeSender(function (payload) {
          if (closed || !connected || !channel) return;
          try { channel.send({ type: "broadcast", event: "m", payload: payload }); } catch (e) { /* ส่งไม่ได้ ข้อความถัดไป/heartbeat จะซิงก์ให้ */ }
        }, function () { return !closed && connected; }),
        close: function () {
          closed = true;
          clearTimeout(retryTimer); clearTimeout(firstTimer);
          if (global.removeEventListener) global.removeEventListener("online", wake);
          if (global.document && global.document.removeEventListener) global.document.removeEventListener("visibilitychange", onVis);
          try { opts.client.removeChannel(channel); } catch (e) { /* ignore */ }
        }
      };
    }

    // ----- BroadcastChannel (เฉพาะเครื่อง/เบราว์เซอร์เดียวกัน) -----
    if (typeof global.BroadcastChannel === "function") {
      var bc = new global.BroadcastChannel(name);
      bc.onmessage = function (e) { if (!closed && e.data) receive(e.data); };
      onStatus("connecting");
      setTimeout(function () { if (!closed) onStatus("connected"); }, 50);
      return {
        transport: "local",
        isConnected: function () { return !closed; },
        reconnect: function () {},
        send: makeSender(function (payload) { if (!closed) bc.postMessage(payload); }),
        close: function () { closed = true; bc.close(); }
      };
    }

    setTimeout(function () { onStatus("error"); }, 0);
    return { transport: "none", isConnected: function () { return false; }, reconnect: function () {}, send: function () {}, close: function () {} };
  }

  global.EduRealtime = {
    genRoomCode: genRoomCode,
    isValidRoomCode: isValidRoomCode,
    uid: uid,
    open: open
  };
})(window);
