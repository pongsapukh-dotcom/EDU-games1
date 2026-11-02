"use strict";

/* =====================================================================
   EduGame v9
   - ล็อกอิน: อีเมล/รหัสผ่าน (Supabase) + โหมดผู้ทดสอบ (ไม่ต้องสมัคร)
   - สร้างชุดคำถามสไตล์ Kahoot (ข้อความ / รูป / รูป+ข้อความใต้ภาพ) 4 ตัวเลือก
   - ห้องเรียนเรียลไทม์: ครูสร้างห้อง นักเรียนกดลิงก์ ใส่ชื่อ แล้วเล่น
   ===================================================================== */

const config = window.EDUGAME_SUPABASE || { url: "", publishableKey: "", imageBucket: "question-images" };
const supabaseConfigured = !!(config.url && config.publishableKey && window.supabase);
const supabaseClient = supabaseConfigured ? window.supabase.createClient(config.url, config.publishableKey) : null;

const LS_TESTER = "edugame_tester_local";
const LS_SETS = "edugame_local_sets";            // ชุดคำถามของผู้ทดสอบ (ชื่อเดิม)
const LS_USERS = "edugame_local_users";          // บัญชีที่สมัครในเครื่อง
const LS_SESSION = "edugame_local_session";      // บัญชีในเครื่องที่ล็อกอินค้างไว้
const LS_STUDENT_NAME = "edugame_student_name";
const LOCAL_USER = { id: "local-tester", email: "ผู้ทดสอบ", local: true, tester: true };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const QUESTION_IMAGE_DIM = 960;
const ANSWER_IMAGE_DIM = 640;

/* ----- รายการเกม (ทุกเกมใช้ชุดคำถามเดียวกัน) ----- */
const GAMES = {
  archery: {
    title: "เกมยิงธนู", pill: "GAME 01", file: "ar_archery_thai_verb_game_full_sfx.html",
    ready: "EDUGAME_AR_READY", setType: "EDUGAME_QUESTION_SET"
  },
  fruit: {
    title: "เกมฟันผลไม้", pill: "GAME 02", file: "ar_fruit_slash_game.html",
    ready: "EDUGAME_FRUIT_READY", setType: "EDUGAME_QUESTION_SET"
  },
  cyber: {
    title: "เกราะเวหาไซเบอร์", pill: "GAME 03", file: "cyber_sky_aero_intercept.html",
    ready: "EDUGAME_CYBER_READY", setType: "EDUGAME_CYBER_QUESTION_SET"
  }
};

/* ----- สถานะ ----- */
let savedSets = [];
let selectedSetIndex = 0;
let editingSetId = null;
let authMode = "login";
let currentUser = null;
let draft = null;          // ชุดคำถามที่กำลังสร้าง/แก้ไข
let activeQ = 0;           // ข้อที่กำลังแก้ไข
let draftFolder = "";      // โฟลเดอร์เก็บรูปบน Storage
let cloudSetsUnavailable = false; // true = ยังไม่ได้สร้างตาราง question_sets บน Supabase -> เก็บในเครื่องแทน

let currentGame = null;    // { key, set, mode, returnTo, delivered }
let room = null;           // ห้องที่ครูเปิดอยู่
let me = null;             // ข้อมูลนักเรียนที่เข้าห้อง

const urlRoom = new URLSearchParams(location.search).get("room");
const studentMode = EduRealtime.isValidRoomCode(urlRoom);

/* ----- ตัวช่วย ----- */
function $(id) { return document.getElementById(id); }
function uid() { return EduRealtime.uid(); }
function escapeHTML(text) {
  return String(text == null ? "" : text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
const escapeAttr = escapeHTML;

let toastTimer = null;
function toast(message, kind) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.className = "toast show " + (kind || "info");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, kind === "error" ? 5200 : 3200);
}

/* =====================================================================
   เริ่มต้นระบบ
   ===================================================================== */
function showEnvWarning() {
  const el = $("envWarning");
  if (!el) return;
  const noCamera = !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  let msg = "";
  if (location.protocol === "file:") {
    msg = "⚠️ คุณเปิดไฟล์โดยตรงจากเครื่อง (file://) — เบราว์เซอร์อาจถามสิทธิ์กล้องซ้ำหรือบล็อกบางส่วน และส่งลิงก์ห้องให้เครื่องอื่นไม่ได้ <b>แนะนำ:</b> รัน start.bat (Windows) / start.sh (Mac/Linux) แล้วเปิด http://localhost:8000 หรืออัปโหลดขึ้นโฮสต์ HTTPS (เช่น Netlify / GitHub Pages)";
  } else if (window.isSecureContext === false || noCamera) {
    msg = "⚠️ หน้านี้เปิดผ่าน http ที่ไม่ปลอดภัย เบราว์เซอร์จึง<b>ปิดการใช้กล้อง</b> — เกมยังเล่นได้ด้วยเมาส์/สัมผัส แต่ถ้าต้องการใช้กล้องให้เปิดผ่าน <b>https://</b> หรือ <b>http://localhost</b>";
  }
  if (msg) { el.innerHTML = msg; el.hidden = false; }
}

window.addEventListener("DOMContentLoaded", async () => {
  showEnvWarning();
  if (studentMode) {
    document.body.classList.add("student-mode");
    prepareJoin(urlRoom);
    showPage("join");
    tryAutoRejoin();
    return;
  }
  resetDraft();
  await initAuth();
  await loadSets();
  updateSavedSets();
  updateAuthUI();
});

window.addEventListener("beforeunload", () => {
  if (room) { try { room.ch.send({ t: "close" }); } catch (e) { /* ignore */ } }
  if (me) { try { me.ch.send({ t: "bye", id: me.id }); } catch (e) { /* ignore */ } }
});

function showPage(pageId) {
  if (studentMode && pageId !== "join" && pageId !== "play") return;
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const target = $(pageId);
  if (!target) return;
  target.classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (pageId === "games") updateSavedSets();
  if (pageId === "login") updateAuthUI();
}
function goHome() { showPage("home"); }

function requireLogin() {
  if (currentUser) return true;
  toast("กรุณาเข้าสู่ระบบก่อน (หรือกด “เข้าใช้งานแบบผู้ทดสอบ”)", "error");
  showPage("login");
  return false;
}

/* =====================================================================
   ระบบล็อกอิน
   ===================================================================== */
function isTester(user) { return !!(user && ((user.local && !user.account) || user.is_anonymous)); }

function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, val); return true; } catch (e) { return false; } }
function lsDel(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }

async function initAuth() {
  if (lsGet(LS_TESTER) === "1") currentUser = LOCAL_USER;
  const sid = lsGet(LS_SESSION);
  if (sid) {
    const rec = localUsers().find(u => u.id === sid);
    if (rec) currentUser = localUserObject(rec);
  }
  if (!supabaseClient) return;
  try {
    const { data } = await supabaseClient.auth.getSession();
    if (data?.session?.user) { currentUser = data.session.user; lsDel(LS_TESTER); lsDel(LS_SESSION); }
  } catch (e) { console.warn("getSession ไม่สำเร็จ", e); }
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (session?.user) currentUser = session.user;
    else if (currentUser && !currentUser.local) currentUser = null;
    setTimeout(async () => { await loadSets(); updateSavedSets(); updateAuthUI(); }, 0);
  });
}

function toggleAuthMode() {
  authMode = authMode === "login" ? "signup" : "login";
  $("authTitle").textContent = authMode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก";
  $("authSubtitle").textContent = authMode === "login" ? "สำหรับครูผู้สร้างชุดคำถาม" : "สร้างบัญชีครูสำหรับ EduGame";
  $("authButton").textContent = authMode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก";
  $("toggleAuthButton").textContent = authMode === "login" ? "ยังไม่มีบัญชี? สมัครสมาชิก" : "มีบัญชีแล้ว? เข้าสู่ระบบ";
  $("authStatus").textContent = "";
}

/* ---------- บัญชีในเครื่อง (ใช้เมื่อยังไม่ได้ตั้งค่า Supabase หรือเชื่อมต่อคลาวด์ไม่ได้) ---------- */
function localUsers() {
  try { const v = JSON.parse(lsGet(LS_USERS) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function localUserObject(rec) { return { id: "local-" + rec.id, email: rec.email, local: true, account: true }; }

function simpleHash(str) { // สำรอง กรณีเบราว์เซอร์ไม่มี crypto.subtle
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let r = 0; r < 2000; r++) {
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  }
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}
async function hashPassword(password, salt) {
  const subtle = window.crypto && window.crypto.subtle;
  if (subtle && window.TextEncoder) {
    try {
      const enc = new TextEncoder();
      const key = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
      const bits = await subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" }, key, 256);
      return "pbkdf2:" + Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (e) { /* ใช้วิธีสำรอง */ }
  }
  return "simple:" + simpleHash(salt + "|" + password);
}
async function localRegister(email, password) {
  const users = localUsers();
  if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) throw new Error("อีเมลนี้สมัครไว้แล้วในเครื่องนี้ กรุณาเข้าสู่ระบบ");
  const salt = uid();
  const rec = { id: uid(), email, salt, hash: await hashPassword(password, salt), created_at: new Date().toISOString() };
  users.push(rec);
  if (!lsSet(LS_USERS, JSON.stringify(users))) throw new Error("บันทึกบัญชีไม่ได้ (เบราว์เซอร์ปิดการเก็บข้อมูลอยู่?)");
  return rec;
}
// คืนค่า: record = สำเร็จ, null = ไม่พบบัญชี, false = รหัสผ่านผิด
async function localLogin(email, password) {
  const rec = localUsers().find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!rec) return null;
  return (await hashPassword(password, rec.salt)) === rec.hash ? rec : false;
}
function startLocalSession(rec) {
  lsSet(LS_SESSION, rec.id); lsDel(LS_TESTER);
  currentUser = localUserObject(rec);
}

function isNetworkError(e) {
  const msg = String((e && (e.message || e.name)) || e);
  return !!(e && (e.status === 0 || e.name === "AuthRetryableFetchError")) ||
    /failed to fetch|networkerror|network request|load failed|timeout|fetch/i.test(msg);
}
function friendlyAuthError(e) {
  const m = String((e && e.message) || e);
  if (/invalid login credentials/i.test(m)) return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  if (/already registered|already been registered/i.test(m)) return "อีเมลนี้สมัครสมาชิกไว้แล้ว กรุณาเข้าสู่ระบบ";
  if (/email not confirmed/i.test(m)) return "ยังไม่ได้ยืนยันอีเมล กรุณากดลิงก์ในอีเมลที่ระบบส่งให้ก่อน";
  if (/rate limit|too many/i.test(m)) return "ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่";
  if (/password.*(at least|should be)/i.test(m)) return "รหัสผ่านสั้นเกินไป (อย่างน้อย 6 ตัวอักษร)";
  if (/invalid.*email|email.*invalid/i.test(m)) return "รูปแบบอีเมลไม่ถูกต้อง";
  if (/signups? (are )?disabled|not allowed/i.test(m)) return "ระบบปิดการสมัครด้วยอีเมลบนคลาวด์ (เจ้าของระบบต้องเปิดใน Supabase)";
  return m;
}

async function finishLogin(message) {
  toast(message);
  await loadSets(); updateSavedSets(); updateAuthUI(); goHome();
}

async function submitAuth() {
  const email = $("email").value.trim(), password = $("password").value;
  if (!email || !password) { toast("กรุณากรอกอีเมลและรหัสผ่าน", "error"); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast("รูปแบบอีเมลไม่ถูกต้อง", "error"); return; }
  if (password.length < 6) { toast("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร", "error"); return; }
  const btn = $("authButton");
  btn.disabled = true;
  try {
    // 1) ลองบนคลาวด์ (Supabase) ก่อน
    let useLocal = !supabaseClient;
    if (supabaseClient) {
      try {
        const result = authMode === "signup"
          ? await supabaseClient.auth.signUp({ email, password })
          : await supabaseClient.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        if (authMode === "signup" && !result.data.session) {
          toast("สมัครสมาชิกสำเร็จ 🎉 กรุณาเปิดอีเมลและกดลิงก์ยืนยัน แล้วกลับมาเข้าสู่ระบบ");
          toggleAuthMode();
          return;
        }
        lsDel(LS_TESTER); lsDel(LS_SESSION);
        currentUser = result.data.session?.user || result.data.user || currentUser;
        cloudSetsUnavailable = false;
        await finishLogin(authMode === "login" ? "เข้าสู่ระบบสำเร็จ 🎉" : "สมัครสมาชิกสำเร็จ 🎉");
        return;
      } catch (e) {
        if (isNetworkError(e)) useLocal = true;                 // คลาวด์ใช้ไม่ได้ -> ใช้บัญชีในเครื่อง
        else if (authMode === "login" && /invalid login credentials/i.test(String(e.message)) &&
                 localUsers().some(u => u.email.toLowerCase() === email.toLowerCase())) useLocal = true; // อาจเป็นบัญชีในเครื่อง
        else throw e;
      }
    }
    // 2) บัญชีในเครื่อง
    if (useLocal) {
      if (authMode === "signup") {
        const rec = await localRegister(email, password);
        startLocalSession(rec);
        await finishLogin("สมัครสมาชิกสำเร็จ 🎉 (บัญชีเก็บในเครื่องนี้)");
      } else {
        const rec = await localLogin(email, password);
        if (!rec) throw new Error(rec === null ? "ไม่พบบัญชีนี้ในเครื่อง กรุณาสมัครสมาชิกก่อน" : "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
        startLocalSession(rec);
        await finishLogin("เข้าสู่ระบบสำเร็จ 🎉");
      }
    }
  } catch (e) {
    toast("ดำเนินการไม่สำเร็จ: " + friendlyAuthError(e), "error");
  } finally { btn.disabled = false; }
}

/* ผู้ทดสอบ: พยายามใช้ Supabase Anonymous Sign-in ก่อน ถ้าไม่ได้ให้ใช้โหมดในเครื่อง */
async function testerLogin() {
  const btn = $("testerButton");
  btn.disabled = true;
  try {
    let cloud = false;
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.auth.signInAnonymously();
        if (error) throw error;
        currentUser = data.user || data.session?.user;
        lsDel(LS_TESTER); lsDel(LS_SESSION);
        cloudSetsUnavailable = false;
        cloud = !!currentUser;
      } catch (e) {
        console.warn("Anonymous sign-in ใช้ไม่ได้ จะใช้โหมดทดสอบในเครื่องแทน:", e.message || e);
      }
    }
    if (!cloud) {
      lsSet(LS_TESTER, "1"); lsDel(LS_SESSION);
      currentUser = LOCAL_USER;
    }
    await loadSets(); updateSavedSets(); updateAuthUI();
    toast(cloud ? "เข้าสู่ระบบแบบผู้ทดสอบแล้ว 🧪" : "เข้าสู่โหมดผู้ทดสอบแล้ว 🧪 (เก็บข้อมูลในเครื่องนี้)");
    openCreate();
  } finally { btn.disabled = false; }
}

async function logout() {
  if (currentUser && !currentUser.local && currentUser.is_anonymous &&
      !confirm("บัญชีผู้ทดสอบไม่มีรหัสผ่าน ถ้าออกจากระบบจะกลับมาเปิดชุดคำถามเดิมไม่ได้ ต้องการออกจากระบบหรือไม่?")) return;
  if (room) closeHostRoom(true);
  if (currentUser?.local) { lsDel(LS_TESTER); lsDel(LS_SESSION); }
  else if (supabaseClient) { try { await supabaseClient.auth.signOut(); } catch (e) { /* ignore */ } }
  currentUser = null; savedSets = []; cloudSetsUnavailable = false;
  updateAuthUI(); updateSavedSets(); goHome();
}

function updateAuthUI() {
  const nav = $("loginNav"), note = $("authNote");
  const loggedIn = !!currentUser;
  $("authForm").classList.toggle("hidden", loggedIn);
  $("accountBox").classList.toggle("hidden", !loggedIn);
  $("authTitle").textContent = loggedIn ? "บัญชีของฉัน" : (authMode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก");
  $("authSubtitle").textContent = loggedIn ? "" : (authMode === "login" ? "สำหรับครูผู้สร้างชุดคำถาม" : "สร้างบัญชีครูสำหรับ EduGame");
  if (loggedIn) {
    nav.textContent = isTester(currentUser) ? "🧪 ผู้ทดสอบ" : "บัญชีของฉัน";
    if (currentUser.account) nav.textContent = "👤 " + String(currentUser.email).split("@")[0].slice(0, 14);
    if (currentUser.local && currentUser.account) {
      $("accountName").textContent = currentUser.email;
      $("accountHint").textContent = "บัญชีนี้เก็บในเบราว์เซอร์เครื่องนี้ ชุดคำถามจะไม่ตามไปเครื่องอื่น — กดปุ่ม “สำรองข้อมูล” ที่หน้าเลือกเกมเพื่อบันทึกเป็นไฟล์";
    } else if (currentUser.local) {
      $("accountName").textContent = "🧪 ผู้ทดสอบ (โหมดในเครื่อง)";
      $("accountHint").textContent = "ชุดคำถามและรูปเก็บไว้ในเบราว์เซอร์เครื่องนี้ ใช้สร้างห้องให้นักเรียนได้ตามปกติ";
    } else if (currentUser.is_anonymous) {
      $("accountName").textContent = "🧪 ผู้ทดสอบ (บันทึกบนคลาวด์)";
      $("accountHint").textContent = "บัญชีนี้ไม่มีรหัสผ่าน ถ้าออกจากระบบจะเข้าถึงชุดคำถามเดิมไม่ได้";
    } else {
      $("accountName").textContent = currentUser.email || "บัญชีครู";
      $("accountHint").textContent = "เข้าสู่ระบบแล้ว ชุดคำถามบันทึกบนคลาวด์";
    }
  } else {
    nav.textContent = "เข้าสู่ระบบ";
  }
  if (note) {
    note.textContent = supabaseConfigured
      ? (loggedIn ? "" : "นักเรียนไม่ต้องล็อกอิน ใช้ลิงก์ห้องที่ครูส่งให้")
      : "ยังไม่ได้ตั้งค่า Supabase — ใช้โหมดผู้ทดสอบ (เก็บข้อมูลในเครื่อง) ได้";
  }
  const notice = $("cloudNotice");
  if (notice) {
    if (currentUser && usesLocalSets()) {
      notice.textContent = cloudSetsUnavailable
        ? "⚠️ ยังไม่ได้สร้างตารางบน Supabase (ดูไฟล์ supabase-setup.sql) — ตอนนี้ชุดคำถามถูกเก็บในเบราว์เซอร์เครื่องนี้แทน"
        : "💾 ชุดคำถามและรูปจะถูกเก็บในเบราว์เซอร์เครื่องนี้ (ใช้ปุ่ม “สำรองข้อมูล” เพื่อเก็บเป็นไฟล์)";
      notice.classList.add("show");
    } else { notice.textContent = ""; notice.classList.remove("show"); }
  }
}

/* =====================================================================
   ที่เก็บชุดคำถาม (คลาวด์ / ในเครื่อง)
   ===================================================================== */
function usesLocalSets() { return !!(currentUser && (currentUser.local || cloudSetsUnavailable)); }
function setsKey() {
  if (!currentUser || currentUser.id === LOCAL_USER.id) return LS_SETS;
  return LS_SETS + "_" + currentUser.id;
}
function localLoad() {
  try { const v = JSON.parse(lsGet(setsKey()) || "[]"); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}
function localSave(sets) {
  try { localStorage.setItem(setsKey(), JSON.stringify(sets)); }
  catch (e) { throw new Error("พื้นที่เก็บข้อมูลในเครื่องเต็ม ลองลดจำนวน/ขนาดรูปภาพ หรือลบชุดคำถามเก่า"); }
}
function isMissingTableError(error) {
  const t = String((error && error.code) || "") + " " + String((error && error.message) || "") + " " + String((error && error.status) || "");
  return /PGRST205|42P01|schema cache|does not exist|could not find the table|\b404\b/i.test(t);
}

async function loadSets() {
  if (!currentUser) { savedSets = []; return; }
  if (!currentUser.local && supabaseClient && !cloudSetsUnavailable) {
    const { data, error } = await supabaseClient.from("question_sets")
      .select("id,name,description,questions,created_at,updated_at")
      .eq("user_id", currentUser.id).order("updated_at", { ascending: false });
    if (error) {
      if (isMissingTableError(error)) { cloudSetsUnavailable = true; }
      else { console.error("โหลดชุดคำถามไม่สำเร็จ", error); toast("โหลดชุดคำถามไม่สำเร็จ: " + (error.message || ""), "error"); return; }
    } else { savedSets = data || []; }
  }
  if (usesLocalSets()) {
    savedSets = localLoad().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }
  if (selectedSetIndex >= savedSets.length) selectedSetIndex = Math.max(0, savedSets.length - 1);
}

function persistLocal(record) {
  const now = new Date().toISOString();
  const sets = localLoad();
  const idx = editingSetId ? sets.findIndex(s => s.id === editingSetId) : -1;
  if (idx >= 0) sets[idx] = { ...sets[idx], ...record, updated_at: now };
  else sets.unshift({ id: uid(), ...record, created_at: now, updated_at: now });
  localSave(sets);
}

async function persistSet(record) {
  const now = new Date().toISOString();
  if (usesLocalSets()) { persistLocal(record); return; }
  if (!supabaseClient) throw new Error("ยังไม่ได้เชื่อมต่อ Supabase");
  let error;
  if (editingSetId) {
    ({ error } = await supabaseClient.from("question_sets")
      .update({ ...record, updated_at: now }).eq("id", editingSetId).eq("user_id", currentUser.id));
  } else {
    ({ error } = await supabaseClient.from("question_sets").insert({ user_id: currentUser.id, ...record }));
  }
  if (error) {
    if (isMissingTableError(error)) { cloudSetsUnavailable = true; persistLocal(record); updateAuthUI(); return; }
    throw error;
  }
}

/* สำรอง / นำเข้าชุดคำถามเป็นไฟล์ JSON */
function exportSets() {
  if (!requireLogin()) return;
  if (!savedSets.length) { toast("ยังไม่มีชุดคำถามให้สำรอง", "error"); return; }
  const payload = {
    app: "edugame", version: 1, exported_at: new Date().toISOString(),
    sets: savedSets.map(s => ({ name: s.name, description: s.description || "", questions: s.questions || [] }))
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "edugame-sets-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("บันทึกไฟล์สำรองแล้ว 💾");
}

async function importSets(file) {
  if (!file || !requireLogin()) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.sets;
    if (!Array.isArray(list) || !list.length) throw new Error("ไม่พบชุดคำถามในไฟล์");
    let n = 0;
    for (const item of list.slice(0, 100)) {
      const questions = EduCommon.normalizeQuestions(item.questions).map(q => ({
        localId: uid(), question: q.question, image_url: q.image_url,
        answers: q.answers.map(a => ({ text: a.text, image_url: a.image_url })), correct: q.correct
      })).filter(q => q.question.trim());
      if (!questions.length) continue;
      editingSetId = null;
      await persistSet({ name: String(item.name || "ชุดคำถามที่นำเข้า").slice(0, 80), description: String(item.description || "").slice(0, 160), questions });
      n++;
    }
    await loadSets(); updateSavedSets();
    if (n) toast("นำเข้าชุดคำถาม " + n + " ชุดแล้ว 🎉"); else toast("ไม่พบคำถามที่ใช้ได้ในไฟล์", "error");
  } catch (e) { toast("นำเข้าไม่สำเร็จ: " + (e.message || e), "error"); }
}

/* =====================================================================
   หน้าสร้างชุดคำถาม (สไตล์ Kahoot)
   ===================================================================== */
function newAnswer() { return { text: "", image_url: "" }; }
function newQuestion() {
  return { localId: uid(), question: "", image_url: "", answers: [0, 1, 2, 3].map(newAnswer), correct: 0 };
}

function resetDraft() {
  draft = { questions: [newQuestion()] };
  activeQ = 0; editingSetId = null; draftFolder = uid();
  $("setName").value = ""; $("setDescription").value = "";
  updateCreateLabel();
  renderCreator();
}

function loadDraftFromSet(set) {
  const qs = (set.questions || []).map(q => {
    const n = EduCommon.normalizeQuestion(q);
    return { localId: q.localId || uid(), question: n.question, image_url: n.image_url, answers: n.answers, correct: n.correct };
  });
  draft = { questions: qs.length ? qs : [newQuestion()] };
  activeQ = 0; editingSetId = set.id; draftFolder = set.id || uid();
  $("setName").value = set.name || ""; $("setDescription").value = set.description || "";
  updateCreateLabel();
  renderCreator();
}

function updateCreateLabel() {
  const el = $("createModeLabel");
  if (el) el.textContent = editingSetId ? "กำลังแก้ไข" : "สร้างใหม่";
}

function openCreate() {
  if (!requireLogin()) return;
  showPage("create");
}

function cancelEditSet() {
  const hasContent = $("setName").value.trim() || draft.questions.some(q => q.question.trim());
  if (hasContent && !confirm("ยกเลิกและล้างข้อมูลที่กำลังสร้างอยู่หรือไม่?")) return;
  resetDraft();
  showPage("games");
}

function isQuestionComplete(q) {
  return !!q.question.trim() && q.answers.every(a => a.text.trim() || a.image_url);
}

function renderCreator() { renderRail(); renderStage(); }

function renderRail() {
  const rail = $("qRail");
  if (!rail) return;
  rail.innerHTML = draft.questions.map((q, i) => `
    <div class="kh-thumb ${i === activeQ ? "active" : ""} ${isQuestionComplete(q) ? "" : "incomplete"}">
      <button type="button" class="kh-thumb-main" onclick="selectQuestion(${i})">
        <span class="kh-thumb-num">${i + 1}</span>
        <span class="kh-thumb-body">
          <span class="kh-thumb-title">${escapeHTML(q.question.trim()) || "ยังไม่ได้พิมพ์คำถาม"}</span>
          <span class="kh-thumb-dots">${q.answers.map((a, k) => `<i class="d${k} ${k === q.correct ? "ok" : ""}"></i>`).join("")}</span>
        </span>
        ${q.image_url ? `<img class="kh-thumb-img" src="${escapeAttr(q.image_url)}" alt="">` : ""}
      </button>
      <div class="kh-thumb-actions">
        <button type="button" title="ทำสำเนาข้อนี้" onclick="duplicateQuestion(${i})">⧉</button>
        ${draft.questions.length > 1 ? `<button type="button" title="ลบข้อนี้" onclick="deleteQuestion(${i})">🗑</button>` : ""}
      </div>
    </div>`).join("");
}

function renderStage() {
  const stage = $("qStage");
  const q = draft.questions[activeQ];
  if (!stage || !q) return;
  const accept = "image/png,image/jpeg,image/webp";

  const media = q.image_url
    ? `<div class="kh-media has-image">
         <img src="${escapeAttr(q.image_url)}" alt="รูปประกอบคำถาม">
         <div class="kh-media-actions">
           <label class="kh-chip">เปลี่ยนรูป<input type="file" accept="${accept}" hidden onchange="onQuestionImage(this.files[0]);this.value=''"></label>
           <button type="button" class="kh-chip danger" onclick="removeQuestionImage()">ลบรูป</button>
         </div>
       </div>`
    : `<label class="kh-media kh-drop" id="qDrop">
         <span class="kh-drop-icon">🖼️</span>
         <b>เพิ่มรูปประกอบคำถาม</b>
         <small>ลากรูปมาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์ (PNG, JPG, WEBP ไม่เกิน 5 MB)</small>
         <input type="file" accept="${accept}" hidden onchange="onQuestionImage(this.files[0]);this.value=''">
       </label>`;

  const tiles = q.answers.map((a, i) => {
    const on = i === q.correct;
    // ปุ่มรูปอยู่ท้ายช่องข้อความ (ในกรอบเดียวกัน): ยังไม่มีรูป = ไอคอน 🖼️ กดเลือกรูป / มีรูปแล้ว = รูปย่อ (กดเพื่อเปลี่ยน) + ปุ่ม ✕ ลบรูป
    const imgCtl = a.image_url
      ? `<label class="kh-ans-thumb" title="กดเพื่อเปลี่ยนรูป"><img src="${escapeAttr(a.image_url)}" alt="รูปตัวเลือกที่ ${i + 1}"><input type="file" accept="${accept}" hidden onchange="onAnswerImage(${i},this.files[0]);this.value=''"></label><button type="button" class="kh-ans-rm" title="ลบรูป" aria-label="ลบรูปตัวเลือกที่ ${i + 1}" onclick="removeAnswerImage(${i})">✕</button>`
      : `<label class="kh-ans-pick" title="เพิ่มรูป" aria-label="เพิ่มรูปตัวเลือกที่ ${i + 1}">🖼️<input type="file" accept="${accept}" hidden onchange="onAnswerImage(${i},this.files[0]);this.value=''"></label>`;
    return `
      <div class="kh-ans c${i} ${on ? "is-correct" : ""}">
        <div class="kh-ans-top">
          <span class="kh-num">${i + 1}</span>
          <button type="button" class="kh-correct" aria-pressed="${on}" onclick="setCorrect(${i})">${on ? "✓ คำตอบที่ถูก" : "ตั้งเป็นคำตอบที่ถูก"}</button>
        </div>
        <div class="kh-ans-field">
          <input type="text" class="kh-ans-text" maxlength="80" value="${escapeAttr(a.text)}"
            placeholder="${a.image_url ? "ข้อความใต้ภาพ (ไม่ใส่ก็ได้)" : "พิมพ์ตัวเลือกที่ " + (i + 1)}"
            oninput="onAnswerText(${i},this.value)">
          ${imgCtl}
        </div>
      </div>`;
  }).join("");

  stage.innerHTML = `
    <div class="kh-qcard">
      <div class="kh-qmeta"><span>ข้อ ${activeQ + 1} จาก ${draft.questions.length}</span><span class="kh-time">⏱ 15 วินาที</span></div>
      <textarea id="qText" class="kh-qinput" rows="2" maxlength="200" placeholder="พิมพ์คำถามของคุณที่นี่" oninput="onQuestionText(this.value)">${escapeHTML(q.question)}</textarea>
    </div>
    ${media}
    <div class="kh-answers">${tiles}</div>
    <p class="kh-help">ตัวเลือกใส่ได้ 3 แบบ: ข้อความอย่างเดียว • รูปอย่างเดียว • หรือทั้งรูปและข้อความ — กดไอคอน 🖼️ ท้ายช่องเพื่อเพิ่มรูป (เกมจะแสดงรูป และมีข้อความอยู่ใต้ภาพ)</p>`;

  const drop = $("qDrop");
  if (drop) {
    ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", e => { const f = e.dataTransfer?.files?.[0]; if (f) onQuestionImage(f); });
  }
}

function selectQuestion(i) { activeQ = i; renderCreator(); }
function addQuestion() {
  draft.questions.push(newQuestion());
  activeQ = draft.questions.length - 1;
  renderCreator();
  $("qText")?.focus();
}
function duplicateQuestion(i) {
  const copy = JSON.parse(JSON.stringify(draft.questions[i]));
  copy.localId = uid();
  draft.questions.splice(i + 1, 0, copy);
  activeQ = i + 1;
  renderCreator();
}
function deleteQuestion(i) {
  if (draft.questions.length <= 1) return;
  const q = draft.questions[i];
  if ((q.question.trim() || q.image_url) && !confirm(`ลบข้อ ${i + 1} หรือไม่?`)) return;
  draft.questions.splice(i, 1);
  activeQ = Math.min(activeQ, draft.questions.length - 1);
  renderCreator();
}

function onQuestionText(value) { draft.questions[activeQ].question = value; renderRail(); }
function onAnswerText(i, value) { draft.questions[activeQ].answers[i].text = value; renderRail(); }
function setCorrect(i) { draft.questions[activeQ].correct = i; renderCreator(); }

/* ----- รูปภาพ: ย่อขนาดในเครื่องก่อนเก็บ ----- */
async function fileToDataUrl(file, maxDim) {
  if (!file) throw new Error("ไม่พบไฟล์");
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) throw new Error("ใช้ได้เฉพาะไฟล์ PNG, JPG หรือ WEBP");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("รูปภาพต้องมีขนาดไม่เกิน 5 MB");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("อ่านไฟล์รูปภาพไม่ได้"));
      im.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally { URL.revokeObjectURL(url); }
}

async function onQuestionImage(file) {
  if (!file) return;
  try {
    draft.questions[activeQ].image_url = await fileToDataUrl(file, QUESTION_IMAGE_DIM);
    renderCreator();
  } catch (e) { toast(e.message, "error"); }
}
function removeQuestionImage() { draft.questions[activeQ].image_url = ""; renderCreator(); }

async function onAnswerImage(i, file) {
  if (!file) return;
  try {
    draft.questions[activeQ].answers[i].image_url = await fileToDataUrl(file, ANSWER_IMAGE_DIM);
    renderCreator();
  } catch (e) { toast(e.message, "error"); }
}
function removeAnswerImage(i) { draft.questions[activeQ].answers[i].image_url = ""; renderCreator(); }

/* ----- บันทึก ----- */
function validateDraft(name) {
  if (!name) { toast("กรุณาตั้งชื่อชุดคำถามก่อนบันทึก", "error"); $("setName").focus(); return false; }
  for (let i = 0; i < draft.questions.length; i++) {
    const q = draft.questions[i];
    if (!q.question.trim()) { activeQ = i; renderCreator(); toast(`กรุณาพิมพ์คำถามในข้อ ${i + 1}`, "error"); $("qText")?.focus(); return false; }
    const missing = q.answers.findIndex(a => !a.text.trim() && !a.image_url);
    if (missing >= 0) { activeQ = i; renderCreator(); toast(`ข้อ ${i + 1}: ตัวเลือกที่ ${missing + 1} ยังว่างอยู่ (ใส่ข้อความหรือรูปภาพ)`, "error"); return false; }
  }
  return true;
}

async function dataUrlToBlob(dataUrl) { const r = await fetch(dataUrl); return r.blob(); }

async function prepareQuestions() {
  const cloud = !!(supabaseClient && currentUser && !usesLocalSets());
  const bucket = config.imageBucket || "question-images";
  let fallbacks = 0;
  async function maybeUpload(url, key) {
    if (!cloud || !url || !url.startsWith("data:")) return url;
    try {
      const blob = await dataUrlToBlob(url);
      const path = `${currentUser.id}/${draftFolder}/${key}-${Date.now()}.jpg`;
      const { error } = await supabaseClient.storage.from(bucket).upload(path, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "3600" });
      if (error) throw error;
      return supabaseClient.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    } catch (e) {
      console.warn("อัปโหลดรูปไม่สำเร็จ เก็บรูปไว้ในชุดคำถามแทน:", e.message || e);
      fallbacks++;
      return url;
    }
  }
  const out = [];
  for (const q of draft.questions) {
    const [qImg, ...aImgs] = await Promise.all([
      maybeUpload(q.image_url, `${q.localId}-question`),
      ...q.answers.map((a, i) => maybeUpload(a.image_url, `${q.localId}-answer${i + 1}`))
    ]);
    out.push({
      localId: q.localId,
      question: q.question.trim(),
      image_url: qImg,
      answers: q.answers.map((a, i) => ({ text: a.text.trim(), image_url: aImgs[i] })),
      correct: q.correct
    });
  }
  return { questions: out, fallbacks };
}

async function saveSet() {
  if (!requireLogin()) return;
  const name = $("setName").value.trim(), description = $("setDescription").value.trim();
  if (!validateDraft(name)) return;
  const btn = $("saveSetButton");
  btn.disabled = true; btn.textContent = "กำลังบันทึก...";
  try {
    const { questions, fallbacks } = await prepareQuestions();
    const wasEditing = !!editingSetId;
    await persistSet({ name, description, questions });
    toast(wasEditing ? "แก้ไขชุดคำถามเรียบร้อยแล้ว 🎉" : "บันทึกชุดคำถามเรียบร้อยแล้ว 🎉");
    if (fallbacks) setTimeout(() => toast("อัปโหลดรูปขึ้นคลาวด์ไม่ได้ ระบบเก็บรูปไว้ในชุดคำถามแทน (ตรวจสอบ Storage ของ Supabase)", "error"), 3300);
    resetDraft();
    await loadSets(); updateSavedSets();
    showPage("games");
  } catch (e) {
    console.error(e);
    toast("บันทึกไม่สำเร็จ: " + (e.message || e), "error");
  } finally { btn.disabled = false; btn.textContent = "บันทึกชุดคำถาม"; }
}

function editSet(index) {
  if (!requireLogin()) return;
  const set = savedSets[index];
  if (!set) return;
  loadDraftFromSet(set);
  showPage("create");
}

async function deleteSet(index) {
  if (!requireLogin()) return;
  const set = savedSets[index];
  if (!set) return;
  if (!confirm(`ลบชุดคำถาม “${set.name}” หรือไม่?`)) return;
  try {
    if (usesLocalSets()) localSave(localLoad().filter(s => s.id !== set.id));
    else {
      const { error } = await supabaseClient.from("question_sets").delete().eq("id", set.id).eq("user_id", currentUser.id);
      if (error) throw error;
    }
    await loadSets(); selectedSetIndex = 0; updateSavedSets();
    toast("ลบชุดคำถามแล้ว");
  } catch (e) { toast("ลบไม่สำเร็จ: " + (e.message || e), "error"); }
}

/* =====================================================================
   เลือกชุดคำถาม / เกม
   ===================================================================== */
function updateSavedSets() {
  const panel = $("savedPanel");
  if (!panel) return;
  if (!currentUser) {
    panel.innerHTML = '<b>กรุณาเข้าสู่ระบบ</b><span>เข้าสู่ระบบ หรือกด “เข้าใช้งานแบบผู้ทดสอบ” เพื่อสร้างและใช้ชุดคำถาม</span><div class="set-actions"><button class="primary" onclick="showPage(\'login\')">เข้าสู่ระบบ</button></div>';
    return;
  }
  if (!savedSets.length) {
    panel.innerHTML = '<b>ยังไม่มีชุดคำถาม</b><span>สร้างชุดคำถามก่อนเริ่มเล่น</span><div class="set-actions"><button class="primary" onclick="openCreate()">＋ สร้างชุดคำถาม</button></div>';
    return;
  }
  panel.innerHTML = `<b>ชุดคำถามของฉัน</b><span>เลือกชุดคำถามที่ต้องการนำไปเล่น</span>
    <select id="selectedSet" class="saved-select" onchange="selectSet(this.value)">${savedSets.map((s, i) => `<option value="${i}">${escapeHTML(s.name)}</option>`).join("")}</select>
    <div id="setInfo" class="set-info"></div>
    <div class="set-actions">
      <button class="secondary" onclick="editSet(selectedSetIndex)">✏️ แก้ไข</button>
      <button class="secondary" onclick="deleteSet(selectedSetIndex)">🗑️ ลบ</button>
      <button class="secondary" onclick="openCreate()">＋ สร้างชุดใหม่</button>
      <button class="secondary" onclick="exportSets()" title="บันทึกชุดคำถามทั้งหมดเป็นไฟล์">⬇️ สำรองข้อมูล</button>
      <label class="secondary file-btn" style="cursor:pointer">⬆️ นำเข้า<input type="file" accept="application/json,.json" hidden onchange="importSets(this.files[0]);this.value=''"></label>
    </div>`;
  $("selectedSet").value = String(selectedSetIndex);
  selectSet(selectedSetIndex);
}

function selectSet(index) {
  const n = Number(index);
  if (!savedSets[n]) return;
  selectedSetIndex = n;
  const s = savedSets[n], info = $("setInfo");
  const qs = s.questions || [];
  const withImg = qs.filter(q => q.image_url || (q.answers || []).some(a => a && a.image_url)).length;
  if (info) info.innerHTML = `<strong>${escapeHTML(s.name)}</strong>${s.description ? `<br><span>${escapeHTML(s.description)}</span>` : ""}<br><span>จำนวน ${qs.length} ข้อ${withImg ? ` • มีรูปภาพ ${withImg} ข้อ` : ""}</span>`;
}

function getSelectedSet() { return savedSets[selectedSetIndex] || null; }

function ensureReady() {
  if (!requireLogin()) return false;
  if (!savedSets.length) { toast("ยังไม่มีชุดคำถาม กรุณาสร้างชุดคำถามก่อน", "error"); openCreate(); return false; }
  return true;
}

/* ส่งเฉพาะข้อมูลที่เกมต้องใช้ (ไม่ส่ง user_id ฯลฯ) */
function gameSetPayload(set) {
  return { name: set.name || "ชุดคำถาม", questions: EduCommon.normalizeQuestions(set.questions) };
}

function startSolo(key) {
  if (!ensureReady()) return;
  openGame(key, gameSetPayload(getSelectedSet()), { mode: "solo", returnTo: "games" });
}

/* =====================================================================
   หน้าเล่นเกม (ใช้ร่วมกันทุกเกม)
   ===================================================================== */
function openGame(key, setPayload, opts) {
  const g = GAMES[key];
  if (!g || !setPayload) return;
  opts = opts || {};
  currentGame = { key, set: setPayload, mode: opts.mode || "solo", returnTo: opts.returnTo || "games", delivered: false };
  $("playPill").textContent = g.pill;
  $("playTitle").textContent = " " + g.title;
  $("playBackBtn").textContent = studentMode ? "ออกจากเกม" : "← กลับ";
  showPage("play");
  const frame = $("gameFrame");
  frame.onload = () => setTimeout(() => { if (currentGame && !currentGame.delivered) deliverSet(); }, 500);
  frame.src = g.file + "?ts=" + Date.now();
}

function deliverSet() {
  if (!currentGame) return;
  const frame = $("gameFrame"), g = GAMES[currentGame.key];
  if (!frame?.contentWindow) return;
  frame.contentWindow.postMessage({ type: g.setType, payload: currentGame.set }, "*");
  currentGame.delivered = true;
}

/* เต็มจอ: ใช้ Fullscreen API ถ้ามี (ไม่รองรับบน iPhone) ไม่เช่นนั้นขยายเต็มหน้าต่างด้วย CSS */
function isFullscreen() {
  const wrap = $("gameWrap");
  return document.fullscreenElement === wrap || document.webkitFullscreenElement === wrap || wrap.classList.contains("pseudo-fs");
}
function setPseudoFs(on) {
  $("gameWrap").classList.toggle("pseudo-fs", on);
  document.body.classList.toggle("pseudo-fs-on", on);
}
async function toggleFullscreen() {
  const wrap = $("gameWrap");
  if (isFullscreen()) {
    setPseudoFs(false);
    try { if (document.exitFullscreen && document.fullscreenElement) await document.exitFullscreen(); else if (document.webkitExitFullscreen && document.webkitFullscreenElement) document.webkitExitFullscreen(); } catch (e) { /* ignore */ }
    return;
  }
  const req = wrap.requestFullscreen || wrap.webkitRequestFullscreen;
  if (req) {
    try { await req.call(wrap); return; } catch (e) { /* ใช้แบบ CSS แทน */ }
  }
  setPseudoFs(true);
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && $("gameWrap").classList.contains("pseudo-fs")) setPseudoFs(false);
  if ((e.key === "f" || e.key === "F") && currentGame && !/INPUT|TEXTAREA/.test((e.target || {}).tagName || "")) toggleFullscreen();
});
document.addEventListener("fullscreenchange", () => { const b = $("fsBtn"); if (b) b.textContent = isFullscreen() ? "⛶ ออกเต็มจอ" : "⛶ เต็มจอ"; });

function leaveGame() {
  const frame = $("gameFrame");
  const ctx = currentGame;
  setPseudoFs(false);
  try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); } catch (e) { /* ignore */ }
  if (frame) { frame.onload = null; frame.src = "about:blank"; } // ปิดกล้อง
  currentGame = null;
  if (studentMode) { showPage("join"); renderStudentAfterGame(); }
  else if (ctx?.returnTo === "host" && room) showPage("host");
  else showPage("games");
}

/* ข้อความจากเกมใน iframe */
window.addEventListener("message", e => {
  const frame = $("gameFrame");
  if (!frame || e.source !== frame.contentWindow || !currentGame) return;
  const d = e.data || {};
  const g = GAMES[currentGame.key];
  if (d.type === g.ready) deliverSet();
  else if (d.type === "EDUGAME_SCORE") onGameScore(d.payload || {});
  else if (/^EDUGAME_(FRUIT|CYBER|AR)_RESULT$/.test(String(d.type))) onGameScore({ ...(d.payload || {}), final: true });
  else if (d.type === "EDUGAME_CLOSE_GAME") leaveGame();
  else if (d.type === "EDUGAME_TOGGLE_FULLSCREEN") toggleFullscreen();
});

function onGameScore(p) {
  if (!me || currentGame?.mode !== "student") return;
  const score = Number(p.score);
  if (Number.isFinite(score)) me.score = Math.max(0, Math.min(1e6, Math.round(score)));
  if (p.final) me.done = true;
  savePlayerSession();
  sendScore("score");
}

/* ส่งคะแนน "ค่ารวมล่าสุด" (ไม่ใช่ค่าที่บวกเพิ่ม) พร้อมรหัสรอบและเวลา เพื่อให้ครูกันข้อความเก่า/ซ้ำได้ */
function sendScore(type) {
  if (!me) return;
  me.ch.send({ t: type, id: me.id, name: me.name, score: me.score, done: me.done, run: me.run, ts: Date.now() });
}

/* =====================================================================
   ห้องเรียน: ตัวช่วยร่วม (แถบสถานะการเชื่อมต่อ)
   ===================================================================== */
const BEAT_EVERY_MS = 3000;       // ครูส่ง heartbeat (phase/run/อันดับ) ทุกกี่ ms
const PING_EVERY_MS = 5000;       // นักเรียนส่ง ping (ชื่อ/คะแนนรวมล่าสุด) ทุกกี่ ms
const LOST_AFTER_MS = 20000;      // ครูไม่ได้ยินจากนักเรียนเกินนี้ = "หลุด"
const HOST_SILENT_MS = 12000;     // นักเรียนไม่ได้ยินจากครูเกินนี้ = แจ้ง "ติดต่อครูไม่ได้"
const SET_BROADCAST_GAP_MS = 6000;// ครูส่งชุดคำถามให้คนที่ยังไม่มีได้อย่างมากทุกกี่ ms (กัน hello พร้อมกันถล่มช่องส่ง)
const PLAYER_SESSION_TTL_MS = 6 * 3600 * 1000;

let netBannerTimer = null;
function netBanner(kind, text, autoHideMs) {
  let el = document.getElementById("netBanner");
  if (!el) {
    el = document.createElement("div");
    el.id = "netBanner";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  clearTimeout(netBannerTimer);
  if (!kind) { el.className = "net-banner"; return; }
  el.textContent = text;
  el.className = "net-banner show " + kind;
  if (autoHideMs) netBannerTimer = setTimeout(() => { el.className = "net-banner"; }, autoHideMs);
}

/* รหัสผู้เล่นเก็บใน sessionStorage (ต่อแท็บ) เพื่อให้รีเฟรช/เน็ตหลุดแล้วกลับเข้าห้องเดิมด้วยตัวตนเดิม */
function playerSessionKey(code) { return "edugame_player_" + code; }
function loadPlayerSession(code) {
  try {
    const v = JSON.parse(sessionStorage.getItem(playerSessionKey(code)) || "null");
    if (!v || typeof v.id !== "string" || !v.id || Date.now() - (v.ts || 0) > PLAYER_SESSION_TTL_MS) return null;
    return v;
  } catch (e) { return null; }
}
function savePlayerSession() {
  if (!me) return;
  try {
    sessionStorage.setItem(playerSessionKey(me.code), JSON.stringify({ id: me.id, name: me.name, run: me.run, score: me.score, done: me.done, ts: Date.now() }));
  } catch (e) { /* ไม่มีที่เก็บ ก็ยังเล่นได้ แต่รีเฟรชแล้วจะเป็นผู้เล่นใหม่ */ }
}
function clearPlayerSession(code) { try { sessionStorage.removeItem(playerSessionKey(code)); } catch (e) { /* ignore */ } }

/* =====================================================================
   ห้องเรียน: ฝั่งครู
   ===================================================================== */
function buildRoomLink(code) {
  return location.origin === "null" || location.protocol === "file:"
    ? location.href.split("?")[0].split("#")[0] + "?room=" + code
    : location.origin + location.pathname + "?room=" + code;
}

function openHostRoom(key) {
  if (!ensureReady()) return;
  closeHostRoom(true);
  const set = getSelectedSet();
  const code = EduRealtime.genRoomCode();
  room = { code, gameKey: key, set: gameSetPayload(set), players: new Map(), phase: "lobby", run: 0, ch: null, status: "connecting",
    timers: [], dirty: true, lastBeat: 0, setSentAt: 0 };
  room.ch = EduRealtime.open({ code, client: supabaseClient, onMessage: hostOnMessage, onStatus: hostOnStatus });
  room.timers.push(setInterval(hostTick, 1000));
  renderHost();
  showPage("host");
}

function hostOnStatus(status) {
  if (!room) return;
  const prev = room.status;
  room.status = status;
  if (status === "connected") {
    if (prev === "reconnecting" || prev === "error") netBanner("ok", "🟢 เชื่อมต่อห้องกลับมาแล้ว", 2500);
    room.dirty = true; room.lastBeat = 0; // ส่ง heartbeat/อันดับทันทีหลังต่อกลับ ให้นักเรียนซิงก์
  } else if (status === "reconnecting") {
    netBanner("warn", "🟡 หลุดการเชื่อมต่อ กำลังเชื่อมต่อใหม่อัตโนมัติ… (รายชื่อเดิมยังอยู่)");
  } else if (status === "error") {
    netBanner("warn", "🟡 ยังเชื่อมต่อห้องไม่ได้ ระบบกำลังลองใหม่อัตโนมัติ ตรวจสอบอินเทอร์เน็ตของเครื่องครู");
  }
  renderHost();
}

function cleanName(v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, 20); }

function hostStatePayload(id, p) {
  return {
    t: "state", to: id, phase: room.phase, run: room.run, game: room.gameKey,
    title: GAMES[room.gameKey].title, setName: room.set.name,
    score: p ? p.score : 0, done: p ? !!p.done : false
  };
}

/* ส่งชุดคำถามให้ "ใครก็ตามที่ยังไม่มี" ครั้งเดียวแบบกระจาย (จำกัดความถี่) แทนการตอบ hello ทีละคนด้วยข้อมูลก้อนใหญ่ */
function hostBroadcastSet(force) {
  if (!room || room.phase !== "playing") return;
  const now = Date.now();
  if (!force && now - room.setSentAt < SET_BROADCAST_GAP_MS) return;
  room.setSentAt = now;
  room.ch.send({ t: "set", run: room.run, game: room.gameKey, title: GAMES[room.gameKey].title, set: room.set });
}

function hostOnMessage(m) {
  if (!room || !room.ch || !m || typeof m !== "object") return;
  const now = Date.now();
  const id = String(m.id || "").slice(0, 64);
  if (m.t === "hello" || m.t === "ping" || m.t === "score") {
    if (!id) return;
    let p = room.players.get(id);
    if (!p) {
      if (room.players.size >= 200) return;
      p = { id, name: cleanName(m.name) || "ผู้เล่น", score: 0, done: false, online: true, left: false, seen: now, ts: 0 };
      room.players.set(id, p);
      room.dirty = true;
    }
    p.name = cleanName(m.name) || p.name;
    p.seen = now;
    if (!p.online) room.dirty = true;
    p.online = true; p.left = false;
    if (m.t === "score" || m.t === "ping") {
      // คะแนนที่รับเป็น "ค่ารวมล่าสุด" (กำหนดทับ ไม่ใช่บวกเพิ่ม) ส่งซ้ำกี่ครั้งก็ไม่เบิ้ล
      // กันข้อความเก่า: (1) ข้ามถ้าเป็นของรอบเก่า (run ไม่ตรง) (2) ข้ามถ้าเวลาเก่ากว่าที่เคยรับ (ถึงมาช้า/สลับลำดับ)
      const sameRun = !Number.isFinite(m.run) || m.run === room.run;
      const stamp = Number(m.ts);
      const fresh = !Number.isFinite(stamp) || stamp >= p.ts;
      const sc = Number(m.score);
      if (sameRun && fresh && Number.isFinite(sc)) {
        const next = Math.max(0, Math.min(1e6, Math.round(sc)));
        if (next !== p.score || (!!m.done && !p.done)) room.dirty = true;
        p.score = next;
        p.done = p.done || !!m.done; // เล่นจบแล้วไม่ถอยกลับเป็นยังไม่จบจากข้อความที่มาช้า
        if (Number.isFinite(stamp)) p.ts = stamp;
      }
    }
    if (m.t === "hello") {
      room.ch.send(hostStatePayload(id, p));
      // นักเรียนที่ยังไม่มีชุดคำถามของรอบปัจจุบัน -> ส่งแบบกระจายครั้งเดียว (จำกัดความถี่)
      if (room.phase === "playing" && (m.need || (Number.isFinite(m.run) && m.run !== room.run))) hostBroadcastSet(false);
    }
    renderHost();
  } else if (m.t === "bye" && id && room.players.has(id)) {
    const p = room.players.get(id);
    p.online = false; p.left = true;
    room.dirty = true;
    renderHost();
  }
}

function hostTick() {
  if (!room || !room.ch) return;
  const now = Date.now();
  let changed = false;
  room.players.forEach(p => { if (p.online && now - p.seen > LOST_AFTER_MS) { p.online = false; p.left = false; changed = true; } });
  if (changed) room.dirty = true;
  // heartbeat: บอก phase/run + อันดับ (ย่อ) เป็นช่วง ๆ -> นักเรียนที่พลาดข้อความ start/อันดับจะซิงก์เองได้
  const age = now - room.lastBeat;
  if ((room.dirty && age >= 2000) || age >= BEAT_EVERY_MS) {
    room.lastBeat = now;
    room.ch.send({ t: "beat", phase: room.phase, run: room.run, game: room.gameKey, rows: boardRows().slice(0, 10) });
  }
  if (room.dirty) { room.dirty = false; renderHost(); }
}

function boardRows() {
  return [...room.players.values()].sort((a, b) => b.score - a.score)
    .map(p => ({ n: p.name, s: p.score, d: p.done }));
}

function hostStartGame() {
  if (!room) return;
  if (room.phase === "playing" && !confirm("เริ่มรอบใหม่ให้ทุกคน? คะแนนรอบนี้จะถูกรีเซ็ต")) return;
  room.phase = "playing";
  room.run++;                                   // รหัสรอบ: ใช้แยกคะแนน/ข้อความของรอบเก่าออกจากรอบนี้
  room.players.forEach(p => { p.score = 0; p.done = false; p.ts = 0; });
  room.dirty = true;
  room.setSentAt = Date.now();
  room.lastBeat = 0;
  room.ch.send({ t: "start", run: room.run, game: room.gameKey, title: GAMES[room.gameKey].title, set: room.set });
  renderHost();
}

function hostPlayHere() {
  if (!room) return;
  openGame(room.gameKey, room.set, { mode: "solo", returnTo: "host" });
}

function copyRoomLink() {
  const input = $("hostLink");
  input.select();
  const done = () => toast("คัดลอกลิงก์แล้ว 📋");
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(input.value).then(done, () => { document.execCommand("copy"); done(); });
  else { document.execCommand("copy"); done(); }
}

function closeHostRoom(silent) {
  if (!room) return;
  if (!silent && room.players.size && !confirm("ปิดห้องนี้หรือไม่? นักเรียนทุกคนจะถูกออกจากห้อง")) return;
  try { room.ch.send({ t: "close" }); } catch (e) { /* ignore */ }
  const r = room;
  room = null;
  netBanner(null);
  r.timers.forEach(clearInterval);
  setTimeout(() => r.ch.close(), 400); // รอให้ข้อความปิดห้องส่งออกก่อน
  if (!silent) showPage("games");
}

function renderHost() {
  if (!room) return;
  const g = GAMES[room.gameKey];
  $("hostCode").textContent = room.code;
  $("hostLink").value = buildRoomLink(room.code);
  $("hostSubtitle").textContent = `${g.title} • ชุดคำถาม “${room.set.name}” • ${room.set.questions.length} ข้อ`;

  const t = $("hostTransport");
  const transport = room.ch ? room.ch.transport : ""; // ch ยังไม่ถูกกำหนดตอนสถานะแรก "connecting"
  if (room.status === "error") t.textContent = "🔴 ยังเชื่อมต่อไม่ได้ ระบบกำลังลองใหม่อัตโนมัติ";
  else if (transport === "supabase") t.textContent = room.status === "connected" ? "🟢 เชื่อมต่อเรียลไทม์แล้ว" : room.status === "reconnecting" ? "🟡 หลุดการเชื่อมต่อ กำลังต่อใหม่อัตโนมัติ..." : "🟡 กำลังเชื่อมต่อ...";
  else t.textContent = "🟡 โหมดทดสอบในเครื่อง: เปิดลิงก์ในแท็บอื่นของเบราว์เซอร์นี้เพื่อลองเข้าห้อง (ต้องตั้งค่า Supabase จึงจะใช้ข้ามเครื่องได้)";
  if (location.protocol === "file:") t.textContent += " • ⚠️ เปิดจากไฟล์ในเครื่อง ลิงก์จะใช้กับเครื่องอื่นไม่ได้ ต้องนำเว็บขึ้นโฮสต์ก่อน";

  const players = [...room.players.values()].sort((a, b) => b.score - a.score);
  $("hostCount").textContent = String(players.filter(p => p.online).length);
  $("hostPhase").textContent = room.phase === "playing" ? "กำลังเล่น" : (players.length ? "พร้อมเริ่ม" : "รอผู้เล่น");
  $("hostPhase").className = "phase-badge " + (room.phase === "playing" ? "playing" : "");
  $("hostStartBtn").textContent = room.phase === "playing" ? "↺ เริ่มรอบใหม่" : "▶ เริ่มเกมให้ทุกคน";
  $("hostPlayers").innerHTML = players.length
    ? players.map((p, i) => `
        <div class="player-row ${p.online ? "" : "offline"}">
          <span class="player-rank">${i + 1}</span>
          <span class="player-name">${escapeHTML(p.name)}</span>
          <span class="player-status">${!p.online ? (p.left ? "ออกจากห้อง" : "หลุดการเชื่อมต่อ") : p.done ? "เล่นจบแล้ว" : room.phase === "playing" ? "กำลังเล่น" : "รออยู่"}</span>
          <span class="player-score">${p.score}</span>
        </div>`).join("")
    : '<div class="player-empty">ยังไม่มีนักเรียนเข้าห้อง ส่งลิงก์หรือรหัสห้องให้นักเรียนได้เลย</div>';
}

/* =====================================================================
   ห้องเรียน: ฝั่งนักเรียน
   ===================================================================== */
let studentCode = "";

function prepareJoin(code) {
  studentCode = code;
  $("joinRoomCode").textContent = code;
  try { $("studentName").value = localStorage.getItem(LS_STUDENT_NAME) || ""; } catch (e) { /* ignore */ }
}

function joinByCode() {
  const code = $("homeRoomCode").value.trim();
  if (!EduRealtime.isValidRoomCode(code)) { toast("รหัสห้องต้องเป็นตัวเลข 6 หลัก", "error"); return; }
  location.href = location.pathname + "?room=" + code;
}

function showJoinStep(step) {
  ["joinStepName", "joinStepWait", "joinStepError"].forEach(id => $(id).classList.toggle("hidden", id !== step));
}

function setWait(title, text) {
  $("joinWaitTitle").textContent = title;
  $("joinWaitText").textContent = text;
}

function joinRoom(opts) {
  const name = cleanName($("studentName").value);
  if (!name) { toast("กรุณาใส่ชื่อของคุณ", "error"); $("studentName").focus(); return; }
  try { localStorage.setItem(LS_STUDENT_NAME, name); } catch (e) { /* ignore */ }
  if (me) leaveRoom(true);
  // กลับเข้าห้องเดิม: ใช้รหัสผู้เล่นเดิมที่เก็บไว้ในแท็บนี้ (รีเฟรช/เน็ตหลุดแล้วไม่กลายเป็นผู้เล่นคนใหม่ คะแนนไม่หาย)
  const saved = loadPlayerSession(studentCode);
  const rejoin = !!(saved && saved.id);
  me = {
    id: rejoin ? saved.id : uid(), name, code: studentCode,
    score: rejoin ? Math.max(0, Number(saved.score) || 0) : 0, done: rejoin ? !!saved.done : false,
    run: rejoin ? (Number(saved.run) || 0) : 0,   // รอบล่าสุดที่เครื่องนี้เริ่มเล่น (0 = ยังไม่เคย)
    rejoined: rejoin, exited: false,
    hostSeen: false, hostLast: 0, hostLost: false, needSet: false, hostPhase: "", hostRun: 0,
    inGame: false, board: [], timers: [], title: "", ch: null, connected: false, everConnected: false
  };
  savePlayerSession();
  $("joinMeName").textContent = name;
  setWait(rejoin ? "กำลังกลับเข้าห้อง..." : "กำลังเข้าห้อง...", "กำลังเชื่อมต่อกับครู");
  showJoinStep("joinStepWait");
  me.ch = EduRealtime.open({ code: me.code, client: supabaseClient, onMessage: studentOnMessage, onStatus: studentOnStatus });
  // ตัวจับเวลาทำงานตลอดอายุการอยู่ในห้อง (ไม่สร้างซ้ำเมื่อเชื่อมต่อใหม่) และทำงานเฉพาะตอนเชื่อมต่ออยู่
  const mine = me;
  me.timers.push(setInterval(() => { if (me === mine && mine.connected) sendScore("ping"); }, PING_EVERY_MS));
  me.timers.push(setInterval(() => studentSyncTick(mine), 3000));
}

/* เข้าห้องอัตโนมัติถ้าแท็บนี้เคยเข้าห้องนี้แล้ว (เช่นรีเฟรชหน้า) */
function tryAutoRejoin() {
  const saved = loadPlayerSession(studentCode);
  if (!saved || !cleanName(saved.name)) return;
  $("studentName").value = cleanName(saved.name);
  joinRoom();
}

function sendHello() {
  if (!me || !me.connected) return;
  me.ch.send({ t: "hello", id: me.id, name: me.name, run: me.run, need: !!me.needSet });
}

/* ทุก 3 วินาที: ถ้ายังไม่พบครู / ยังไม่ได้ชุดคำถามของรอบปัจจุบัน -> ขอซ้ำ (หน่วงแบบสุ่มเล็กน้อยกันนักเรียนทั้งห้องส่งพร้อมกัน)
   และถ้าครูเงียบเกินกำหนดให้แจ้งสถานะ */
function studentSyncTick(mine) {
  if (me !== mine || !mine.connected) return;
  const now = Date.now();
  if (mine.hostSeen && now - mine.hostLast > HOST_SILENT_MS) {
    if (!mine.hostLost) { mine.hostLost = true; netBanner("warn", "🟡 ติดต่อครูไม่ได้ชั่วคราว กำลังรอสัญญาณ… (คะแนนที่เล่นไว้ยังอยู่)"); }
  }
  if (!mine.hostSeen || mine.hostLost || mine.needSet) setTimeout(() => { if (me === mine) sendHello(); }, Math.random() * 900);
}

function studentOnStatus(status) {
  if (!me) return;
  if (status === "connected") {
    const first = !me.everConnected;
    me.connected = true; me.everConnected = true;
    sendHello();
    sendScore("ping"); // บอกคะแนนล่าสุดทันทีหลังต่อกลับ
    if (first) {
      me.timers.push(setTimeout(() => { if (me && !me.hostSeen) setWait("ยังไม่พบห้อง", "ตรวจสอบรหัสห้อง หรือรอครูเปิดห้อง ระบบจะลองเชื่อมต่อให้อัตโนมัติ"); }, 6000));
    } else {
      netBanner("ok", "🟢 เชื่อมต่อกลับมาแล้ว", 2500);
    }
    // เคยขึ้นหน้า error ตอนต่อไม่ได้ แล้วต่อสำเร็จภายหลัง -> กลับมาหน้ารอ
    if (!$("joinStepError").classList.contains("hidden") && !currentGame) { setWait("กำลังกลับเข้าห้อง...", "เชื่อมต่อได้แล้ว กำลังติดต่อครู"); showJoinStep("joinStepWait"); }
  } else if (status === "reconnecting") {
    me.connected = false;
    netBanner("warn", "🟡 หลุดการเชื่อมต่อ กำลังเชื่อมต่อใหม่อัตโนมัติ…");
  } else if (status === "error") {
    me.connected = false;
    if (!currentGame) {
      $("joinErrorText").textContent = "ยังเชื่อมต่อห้องเรียนไม่ได้ ระบบกำลังลองใหม่อัตโนมัติ (ตรวจสอบอินเทอร์เน็ตของคุณ)";
      showJoinStep("joinStepError");
    } else netBanner("warn", "🟡 ยังเชื่อมต่อห้องไม่ได้ กำลังลองใหม่… (เล่นต่อได้ คะแนนจะส่งเมื่อต่อกลับ)");
  }
}

function validIncomingSet(set) {
  return set && Array.isArray(set.questions) && set.questions.length > 0 && set.questions.length <= 100;
}

/* ข้อมูลสถานะจากครู (state ส่วนตัว / beat ทุกคน): อัปเดตว่าครูอยู่ในรอบไหน และเราต้องขอชุดคำถามไหม */
function studentOnHostInfo(info) {
  me.hostSeen = true; me.hostLast = Date.now();
  if (me.hostLost) { me.hostLost = false; netBanner("ok", "🟢 ติดต่อครูได้แล้ว", 2000); }
  me.hostPhase = info.phase; me.hostRun = Number(info.run) || 0;
  if (info.title) me.title = info.title;
  // ต้องการชุดคำถามเมื่อ: ครูกำลังเล่นรอบที่เรายังไม่ได้เริ่ม / หรือรีเฟรชกลับมากลางรอบเดิมที่ยังเล่นไม่จบ
  const hadNeed = me.needSet;
  me.needSet = info.phase === "playing" &&
    (me.hostRun !== me.run || (!me.inGame && !me.done && !me.exited));
  if (me.needSet && !hadNeed) { const mine = me; setTimeout(() => { if (me === mine) sendHello(); }, Math.random() * 600); } // เพิ่งรู้ว่าต้องขอชุดคำถาม -> ขอทันที
  if (!me.inGame && !me.needSet) {
    if (me.done && info.phase === "playing") setWait(`เล่นจบแล้ว! ได้ ${me.score} คะแนน`, "รอครูเริ่มรอบใหม่ หรือดูอันดับด้านล่าง");
    else if (info.phase !== "playing" || me.exited) setWait(me.exited ? "ออกจากเกมแล้ว" : "เข้าห้องแล้ว ✓", me.exited ? "ถ้าครูเริ่มรอบใหม่ เกมจะเปิดให้อัตโนมัติ" : "รอครูกดเริ่มเกม" + (info.title ? ` • ${info.title}` : "") + "...");
  } else if (!me.inGame && me.needSet) {
    setWait("ครูเริ่มเกมแล้ว", "กำลังรับชุดคำถาม...");
  }
}

function studentAcceptSet(m) {
  if (!validIncomingSet(m.set) || !GAMES[m.game]) return;
  const run = Number(m.run) || 0;
  const sameRun = run === me.run;
  // รอบเดียวกันที่กำลังเล่น/เล่นจบ/ออกเองแล้ว ไม่เปิดซ้ำ (ข้อความ start/set ซ้ำจะไม่รีเซ็ตเกมที่กำลังเล่นอยู่)
  if (sameRun && (me.inGame || me.done || me.exited)) return;
  me.hostSeen = true; me.hostLast = Date.now();
  if (!sameRun) { me.score = 0; me.done = false; }  // รอบใหม่ เริ่มจาก 0 (กลับเข้ารอบเดิมหลังรีเฟรชจะคงคะแนนที่ครูมีไว้จนกว่าเกมส่งคะแนนใหม่)
  me.run = run; me.exited = false; me.needSet = false;
  savePlayerSession();
  startStudentGame(m.game, m.set);
}

function studentOnMessage(m) {
  if (!me || !m || typeof m !== "object") return;
  if (m.t === "state" && m.to === me.id) {
    // กลับเข้าห้องเดิม: ใช้คะแนน/สถานะที่ครูเก็บไว้ (ครูเป็นต้นทางที่ถูกต้อง) ถ้าอยู่รอบเดียวกัน
    if (me.rejoined) {
      me.rejoined = false;
      const hostScore = Math.max(0, Math.round(Number(m.score) || 0));
      if ((Number(m.run) || 0) === me.run) {          // รอบเดียวกัน: คงค่าที่สูงกว่า (กันคะแนนหายถ้าฝั่งใดฝั่งหนึ่งตกข้อความ)
        me.score = Math.max(me.score, hostScore);
        me.done = me.done || !!m.done;
      } else {                                         // ครูขึ้นรอบใหม่ไปแล้ว: ใช้ค่าของรอบใหม่ที่ครูมี
        me.score = hostScore; me.done = !!m.done;
      }
      savePlayerSession();
    }
    studentOnHostInfo(m);
  } else if (m.t === "beat") {
    studentOnHostInfo(m);
    if (Array.isArray(m.rows)) { me.board = m.rows.slice(0, 10); renderStudentBoard(); }
  } else if (m.t === "start" || m.t === "set") {
    studentAcceptSet(m);
  } else if (m.t === "board" && Array.isArray(m.rows)) {
    me.board = m.rows.slice(0, 10);
    renderStudentBoard();
  } else if (m.t === "close") {
    const msg = "ครูปิดห้องแล้ว ขอบคุณที่ร่วมเล่น";
    clearPlayerSession(me.code);
    leaveRoom(true);
    if (currentGame) leaveGameQuiet();
    netBanner(null);
    $("joinErrorText").textContent = msg;
    showJoinStep("joinStepError");
    showPage("join");
  }
}

function startStudentGame(key, set) {
  me.inGame = true;
  openGame(key, { name: set.name || "ชุดคำถาม", questions: EduCommon.normalizeQuestions(set.questions) }, { mode: "student" });
}

function leaveGameQuiet() {
  const frame = $("gameFrame");
  if (frame) { frame.onload = null; frame.src = "about:blank"; }
  currentGame = null;
}

function renderStudentAfterGame() {
  if (!me) return;
  me.inGame = false;
  me.exited = true;   // ออกจากเกมเอง/เล่นจบ: ไม่เปิดเกมซ้ำเองในรอบเดิม (จะเปิดเมื่อครูเริ่มรอบใหม่)
  savePlayerSession();
  if (me.done) setWait(`เล่นจบแล้ว! ได้ ${me.score} คะแนน`, "รอครูเริ่มรอบใหม่ หรือดูอันดับด้านล่าง");
  else setWait("ออกจากเกมแล้ว", "ถ้าครูเริ่มรอบใหม่ เกมจะเปิดให้อัตโนมัติ");
  renderStudentBoard();
}

function renderStudentBoard() {
  const box = $("studentBoard");
  if (!box || !me) return;
  if (!me.board.length) { box.innerHTML = ""; return; }
  box.innerHTML = '<div class="board-title">🏆 อันดับ</div>' + me.board.map((r, i) =>
    `<div class="board-row ${r.n === me.name ? "me" : ""}"><span>${i + 1}</span><span class="board-name">${escapeHTML(r.n)}</span><b>${Number(r.s) || 0}</b></div>`).join("");
}

function leaveRoom(silent) {
  if (me) {
    if (!silent) clearPlayerSession(me.code);
    netBanner(null);
    try { me.ch.send({ t: "bye", id: me.id }); } catch (e) { /* ignore */ }
    me.timers.forEach(t => { clearInterval(t); clearTimeout(t); });
    const ch = me.ch;
    me = null;
    setTimeout(() => ch.close(), 400);
  }
  if (silent) return;
  if (currentGame) leaveGameQuiet();
  if (studentMode) location.href = location.pathname;
  else goHome();
}
