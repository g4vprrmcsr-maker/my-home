/* ==========================================
   小家 app.js v3
   ========================================== */

const LS_KEY = "home_data_v3";
const OLD_KEYS = ["home_data_v2", "home_data_v1"];
const NL = String.fromCharCode(10);
const LOVE_START = new Date(2026, 5, 7);

let DB = null;
let state = null;
let streaming = false;
let abortCtrl = null;
let pendingImg = null;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaultSettings() {
  const provId = uid();
  return {
    providers: [{ id: provId, name: "默认供应商", baseURL: "", apiKey: "", models: [], model: "" }],
    currentProviderId: provId,
    temperature: 1,
    contextCount: 20,
    fontSize: 14,
    darkMode: false,
    sidebarStyle: "white",
    sidebarAlpha: 72,
    bubbleTexture: "water",
    bubbleShape: "round-lg",
    userBubbleColor: "glass",
    aiBubbleColor: "glass",
    aiBare: false,
    nameWeight: 500,
    chatFont: "system",
    uiFont: "system",
    metaFont: "round",
    metaSize: 10,
    metaWeight: 400,
    metaShade: 150,
    splitSend: false,
    splitMax: 20
  };
}

function defaultState() {
  const roleId = uid();
  const sessionId = uid();
  return {
    settings: defaultSettings(),
    currentRoleId: roleId,
    roles: [{
      id: roleId,
      name: "默认角色",
      systemPrompt: "",
      aiName: "Claude",
      userName: "我",
      currentSessionId: sessionId,
      sessions: [{ id: sessionId, name: "新对话", messages: [] }],
      memories: []
    }]
  };
}

function fillDefaults() {
  const d = defaultSettings();
  for (const k in d) {
    if (state.settings[k] === undefined) state.settings[k] = d[k];
  }
}

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      state = JSON.parse(raw);
      fillDefaults();
      return;
    }
    for (const key of OLD_KEYS) {
      const old = localStorage.getItem(key);
      if (!old) continue;
      const o = JSON.parse(old);
      state = defaultState();
      if (o.roles && o.roles.length) {
        state.roles = o.roles;
        state.currentRoleId = o.currentRoleId || o.roles[0].id;
      }
      if (o.settings) {
        if (o.settings.providers && o.settings.providers.length) {
          state.settings.providers = o.settings.providers;
          state.settings.currentProviderId = o.settings.currentProviderId || o.settings.providers[0].id;
        } else {
          const p = state.settings.providers[0];
          p.baseURL = o.settings.baseURL || "";
          p.apiKey = o.settings.apiKey || "";
          p.models = o.settings.models || [];
          p.model = o.settings.model || "";
        }
        state.settings.temperature = o.settings.temperature || 1;
        state.settings.contextCount = o.settings.contextCount || 20;
        state.settings.fontSize = o.settings.fontSize || 14;
      }
      fillDefaults();
      saveState();
      return;
    }
    state = defaultState();
    saveState();
  } catch (e) {
    state = defaultState();
  }
}

function curRole() {
  return state.roles.find(r => r.id === state.currentRoleId) || state.roles[0];
}

function curSession() {
  const r = curRole();
  return r.sessions.find(s => s.id === r.currentSessionId) || r.sessions[0];
}

function curProvider() {
  const st = state.settings;
  return st.providers.find(p => p.id === st.currentProviderId) || st.providers[0];
}
/* ---------- IndexedDB ---------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("home_images", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("imgs"); };
    req.onsuccess = () => { DB = req.result; resolve(); };
    req.onerror = () => reject(req.error);
  });
}

function putImg(key, blob) {
  return new Promise((resolve, reject) => {
    const tx = DB.transaction("imgs", "readwrite");
    tx.objectStore("imgs").put(blob, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function getImg(key) {
  return new Promise((resolve) => {
    const tx = DB.transaction("imgs", "readonly");
    const rq = tx.objectStore("imgs").get(key);
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror = () => resolve(null);
  });
}

function delImg(key) {
  return new Promise((resolve) => {
    const tx = DB.transaction("imgs", "readwrite");
    tx.objectStore("imgs").delete(key);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

/* ---------- 工具 ---------- */
function $(sel) { return document.querySelector(sel); }

function esc(s) {
  return String(s).replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
}

function toast(msg, ms) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), ms || 3000);
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, "0");
  return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

function loveDays() {
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(LOVE_START.getFullYear(), LOVE_START.getMonth(), LOVE_START.getDate());
  return Math.floor((a - b) / 86400000) + 1;
}

/* ---------- 默认头像 ---------- */
const AI_FALLBACK = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" rx="36" fill="#D97757"/><text x="36" y="46" font-size="30" text-anchor="middle" fill="#fff" font-family="sans-serif">C</text></svg>'
);
const USER_FALLBACK = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" rx="36" fill="#8aa2c8"/><circle cx="36" cy="28" r="12" fill="#fff"/><ellipse cx="36" cy="58" rx="20" ry="14" fill="#fff"/></svg>'
);

const urlCache = {};

async function avatarSrc(kind) {
  const key = curRole().id + "_" + kind;
  if (urlCache[key]) return urlCache[key];
  const blob = await getImg(key);
  if (blob) {
    urlCache[key] = URL.createObjectURL(blob);
    return urlCache[key];
  }
  return kind === "ai"? AI_FALLBACK : USER_FALLBACK;
}

function clearUrlCache() {
  Object.keys(urlCache).forEach(k => {
    URL.revokeObjectURL(urlCache[k]);
    delete urlCache[k];
  });
}

async function applyBg() {
  const bgEl = $("#chat-bg");
  const blob = await getImg(curRole().id + "_bg");
  if (blob) {
    bgEl.style.backgroundImage = "url(" + URL.createObjectURL(blob) + ")";
    bgEl.classList.add("has-bg");
  } else {
    bgEl.style.backgroundImage = "";
    bgEl.classList.remove("has-bg");
  }
}

/* ---------- 图片压缩 ---------- */
function compressImage(file, maxSide, quality) {
  maxSide = maxSide || 1024;
  quality = quality || 0.8;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      if (Math.max(w, h) > maxSide) {
        const k = maxSide / Math.max(w, h);
        w = Math.round(w * k);
        h = Math.round(h * k);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("图片读取失败")); };
    img.src = url;
  });
}
/* ---------- 字体表 ---------- */
const FONT_LIST = {
  system: '-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif',
  round: 'ui-rounded,"SF Pro Rounded","PingFang SC",sans-serif',
  song: '"Songti SC","STSong",Georgia,serif',
  kai: '"Kaiti SC","STKaiti",serif',
  hei: '"PingFang SC","Heiti SC",sans-serif',
  mono: 'ui-monospace,Menlo,Consolas,monospace'
};
const FONT_NAMES = { system: "系统", round: "圆体", song: "宋体", kai: "楷体", hei: "黑体", mono: "等宽" };

/* ---------- 气泡颜色表 ---------- */
const BUBBLE_COLORS = {
  glass: { name: "透明玻璃", bg: "", dark: false },
  white: { name: "白色", bg: "rgba(255,255,255,0.92)", dark: false },
  black: { name: "黑色", bg: "rgba(30,30,30,0.88)", dark: true },
  green: { name: "微信绿", bg: "rgba(149,236,105,0.9)", dark: false },
  blue: { name: "天蓝", bg: "rgba(170,215,250,0.9)", dark: false },
  pink: { name: "粉色", bg: "rgba(250,200,215,0.9)", dark: false }
};

/* ---------- 气泡形状表 ---------- */
const BUBBLE_SHAPES = {
  "round-lg": { name: "大圆角", radius: "16px" },
  "round-sm": { name: "小圆角", radius: "8px" },
  "tail": { name: "小三角", radius: "12px" },
  "comet": { name: "弧线长尾", radius: "16px" }
};

/* ---------- 运行时注入尾巴样式 ---------- */
function injectDynStyle() {
  let el = document.getElementById("dyn-style");
  if (!el) {
    el = document.createElement("style");
    el.id = "dyn-style";
    document.head.appendChild(el);
  }
  const L = [];
  L.push(".bs-tail-user::after{content:'';position:absolute;right:-5px;top:12px;border-style:solid;border-width:5px 0 5px 7px;border-color:transparent transparent transparent var(--tail-c);}");
  L.push(".bs-tail-ai::after{content:'';position:absolute;left:-5px;top:12px;border-style:solid;border-width:5px 7px 5px 0;border-color:transparent var(--tail-c) transparent transparent;}");
  L.push(".bs-comet-user{border-bottom-right-radius:2px;}");
  L.push(".bs-comet-user::after{content:'';position:absolute;right:-7px;bottom:0px;width:14px;height:14px;background:radial-gradient(circle at 0% 0%,transparent 13px,var(--tail-c) 14px);clip-path:polygon(0 30%,100% 100%,0 100%);}");
  L.push(".bs-comet-ai{border-bottom-left-radius:2px;}");
  L.push(".bs-comet-ai::after{content:'';position:absolute;left:-7px;bottom:0px;width:14px;height:14px;background:radial-gradient(circle at 100% 0%,transparent 13px,var(--tail-c) 14px);clip-path:polygon(100% 30%,100% 100%,0 100%);}");
  el.textContent = L.join(NL);
}

/* ---------- 单个气泡上妆 ---------- */
function dressBubble(bubble, isUser) {
  const st = state.settings;
  bubble.className = "msg-bubble";
  bubble.style.cssText = "";

  if (st.aiBare &&!isUser) {
    bubble.style.padding = "0 2px";
    return;
  }

  const colorKey = isUser? st.userBubbleColor : st.aiBubbleColor;
  const c = BUBBLE_COLORS[colorKey] || BUBBLE_COLORS.glass;
  const shape = BUBBLE_SHAPES[st.bubbleShape] || BUBBLE_SHAPES["round-lg"];

  bubble.style.borderRadius = shape.radius;

  let tailColor;
  if (colorKey === "glass") {
    if (st.bubbleTexture === "water") {
      bubble.style.background = "linear-gradient(155deg, rgba(255,255,255,0.34) 0%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.14) 100%)";
      bubble.style.boxShadow = "inset 0 1px 1px rgba(255,255,255,0.5), 0 2px 10px rgba(0,0,0,0.04)";
    } else {
      bubble.style.background = st.darkMode? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.3)";
      bubble.style.boxShadow = "0 1px 8px rgba(0,0,0,0.04)";
    }
    tailColor = st.darkMode? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.3)";
  } else {
    bubble.style.background = c.bg;
    bubble.style.boxShadow = "0 1px 6px rgba(0,0,0,0.05)";
    bubble.style.color = c.dark? "#f0f0f0" : "#1a1a1a";
    tailColor = c.bg;
  }

  if (st.bubbleShape === "tail" || st.bubbleShape === "comet") {
    bubble.style.setProperty("--tail-c", tailColor);
    bubble.classList.add("bs-" + st.bubbleShape + "-" + (isUser? "user" : "ai"));
  }
}

/* ---------- 全局主题 ---------- */
function applyTheme() {
  const st = state.settings;
  document.body.classList.toggle("dark", st.darkMode);
  document.documentElement.style.setProperty("--msg-fs", st.fontSize + "px");

  const sb = $("#sidebar");
  const a = (st.sidebarAlpha || 72) / 100;
  const base = st.darkMode? "40,40,40" : "255,255,255";
  if (st.sidebarStyle === "glass") {
    sb.style.background = "rgba(" + base + "," + a + ")";
    sb.style.backdropFilter = "blur(24px) saturate(1.6)";
    sb.style.webkitBackdropFilter = "blur(24px) saturate(1.6)";
  } else if (st.sidebarStyle === "clear") {
    sb.style.background = "rgba(" + base + "," + (a * 0.35) + ")";
    sb.style.backdropFilter = "blur(5px) saturate(1.3)";
    sb.style.webkitBackdropFilter = "blur(5px) saturate(1.3)";
  } else {
    sb.style.background = "";
    sb.style.backdropFilter = "";
    sb.style.webkitBackdropFilter = "";
  }

  $("#chat-area").style.fontFamily = FONT_LIST[st.chatFont];
  $("#input-text").style.fontFamily = FONT_LIST[st.chatFont];
  sb.style.fontFamily = FONT_LIST[st.uiFont];
  $("#topbar-title").style.fontFamily = FONT_LIST[st.uiFont];
}

/* ---------- 小字上妆 ---------- */
function dressMeta(row, isUser) {
  const st = state.settings;
  const F = FONT_LIST[st.metaFont];
  const g = st.darkMode? Math.min(255, st.metaShade + 60) : st.metaShade;
  const gray = "rgb(" + g + "," + g + "," + g + ")";
  const ng = st.darkMode? Math.min(255, g + 20) : Math.max(60, g - 40);
  const nameGray = "rgb(" + ng + "," + ng + "," + ng + ")";

  row.querySelectorAll(".msg-name").forEach(el => {
    el.style.fontFamily = F;
    el.style.fontWeight = String(st.nameWeight);
    el.style.fontSize = (st.metaSize + 1) + "px";
    el.style.color = nameGray;
  });
  row.querySelectorAll(".msg-time").forEach(el => {
    el.style.fontFamily = F;
    el.style.fontWeight = String(st.metaWeight);
    el.style.fontSize = st.metaSize + "px";
    el.style.color = gray;
  });
  row.querySelectorAll(".msg-footer").forEach(el => {
    el.style.fontFamily = F;
    el.style.fontWeight = String(st.metaWeight);
    el.style.fontSize = st.metaSize + "px";
    el.style.color = gray;
  });
}
/* ---------- 消息渲染 ---------- */
function msgText(m) {
  return m.versions[m.vi];
}

async function renderMessages() {
  const area = $("#chat-area");
  area.innerHTML = "";
  const s = curSession();
  const r = curRole();
  const aiSrc = await avatarSrc("ai");
  const userSrc = await avatarSrc("user");

  s.messages.forEach(m => {
    const isUser = m.role === "user";
    const row = document.createElement("div");
    row.className = "msg-row " + (isUser? "msg-row-user" : "msg-row-ai");
    row.dataset.id = m.id;

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "msg-check";
    check.dataset.id = m.id;

    const avatar = document.createElement("img");
    avatar.className = "msg-avatar";
    avatar.src = isUser? userSrc : aiSrc;

    const body = document.createElement("div");
    body.className = "msg-body " + (isUser? "msg-body-user" : "msg-body-ai");

    const meta = document.createElement("div");
    meta.className = "msg-meta " + (isUser? "msg-meta-user" : "msg-meta-ai");
    const nameEl = document.createElement("span");
    nameEl.className = "msg-name";
    nameEl.textContent = isUser? r.userName : r.aiName;
    const timeEl = document.createElement("span");
    timeEl.className = "msg-time";
    timeEl.textContent = fmtTime(m.time);
    meta.appendChild(nameEl);
    meta.appendChild(timeEl);

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    if (m.img) {
      const im = document.createElement("img");
      im.className = "msg-img";
      im.src = m.img;
      bubble.appendChild(im);
    }
    const txtNode = document.createElement("span");
    txtNode.className = "msg-txt";
    txtNode.textContent = msgText(m);
    bubble.appendChild(txtNode);

    const footer = document.createElement("div");
    footer.className = "msg-footer";

    if (!isUser && m.versions.length > 1) {
      const vs = document.createElement("div");
      vs.className = "version-switch";
      const prev = document.createElement("button");
      prev.className = "vs-btn";
      prev.textContent = "‹";
      const label = document.createElement("span");
      label.textContent = (m.vi + 1) + "/" + m.versions.length;
      const next = document.createElement("button");
      next.className = "vs-btn";
      next.textContent = "›";
      const move = (d) => {
        m.vi = Math.max(0, Math.min(m.versions.length - 1, m.vi + d));
        saveState();
        renderMessages();
      };
      prev.onclick = (e) => { e.stopPropagation(); move(-1); };
      next.onclick = (e) => { e.stopPropagation(); move(1); };
      vs.appendChild(prev);
      vs.appendChild(label);
      vs.appendChild(next);
      footer.appendChild(vs);
    }

    if (!isUser && m.tokens) {
      const tk = document.createElement("span");
      tk.textContent = m.tokens + " tokens";
      footer.appendChild(tk);
    }

    body.appendChild(meta);
    body.appendChild(bubble);
    body.appendChild(footer);
    row.appendChild(check);
    row.appendChild(avatar);
    row.appendChild(body);
    area.appendChild(row);

    dressBubble(bubble, isUser);
    dressMeta(row, isUser);
    bindLongPress(bubble, (x, y) => msgMenu(m, x, y));
  });

  area.scrollTop = area.scrollHeight;
}

/* ---------- 操作菜单 ---------- */
function closeActions() {
  document.querySelectorAll(".msg-actions").forEach(m => {
    if (m._closer) {
      document.removeEventListener("touchstart", m._closer, true);
      document.removeEventListener("click", m._closer, true);
    }
    m.remove();
  });
}

function showActions(items, x, y) {
  closeActions();
  const menu = document.createElement("div");
  menu.className = "msg-actions";
  items.forEach(it => {
    const b = document.createElement("button");
    b.className = "act-btn" + (it.danger? " danger" : "");
    b.textContent = it.label;
    const run = (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeActions();
      it.fn();
    };
    b.addEventListener("touchend", run);
    b.addEventListener("click", run);
    menu.appendChild(b);
  });
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + "px";
  setTimeout(() => {
    menu._closer = (e) => {
      if (!menu.contains(e.target)) closeActions();
    };
    document.addEventListener("touchstart", menu._closer, true);
    document.addEventListener("click", menu._closer, true);
  }, 80);
}

function bindLongPress(el, fn) {
  let timer = null;
  let moved = false;
  el.addEventListener("touchstart", (e) => {
    moved = false;
    const t = e.touches[0];
    timer = setTimeout(() => {
      timer = null;
      fn(t.clientX, t.clientY);
    }, 480);
  }, { passive: true });
  el.addEventListener("touchmove", () => { moved = true; clearTimeout(timer); timer = null; }, { passive: true });
  el.addEventListener("touchend", () => { clearTimeout(timer); });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    fn(e.clientX, e.clientY);
  });
}

function msgMenu(m, x, y) {
  if (streaming) return;
  const s = curSession();
  const items = [
    { label: "复制", fn: () => {
        navigator.clipboard.writeText(msgText(m)).then(
          () => toast("已复制"),
          () => toast("复制失败")
        );
      } },
    { label: "编辑", fn: () => {
        inputDialog("编辑消息", msgText(m), v => {
          if (v.trim()) {
            m.versions[m.vi] = v;
            saveState();
            renderMessages();
          }
        }, true);
      } }
  ];
  if (m.img) {
    items.push({ label: "删除图片", danger: true, fn: () => confirmDialog("删除这张图片？", () => {
        delete m.img;
        saveState();
        renderMessages();
      }) });
  }
  if (m.role === "ai") {
    items.push({ label: "重新生成", fn: () => regenerate(m) });
  }
  items.push({ label: "删除", danger: true, fn: () => confirmDialog("删除这条消息？", () => {
      s.messages = s.messages.filter(x2 => x2.id!== m.id);
      saveState();
      renderMessages();
    }) });
  showActions(items, x, y);
}

/* ---------- 弹窗 ---------- */
function inputDialog(title, initial, onOk, multiline) {
  const mask = document.createElement("div");
  mask.className = "dialog-mask";
  const dlg = document.createElement("div");
  dlg.className = "dialog";
  const h = document.createElement("div");
  h.className = "dialog-title";
  h.textContent = title;
  const input = document.createElement(multiline? "textarea" : "input");
  input.className = multiline? "dialog-textarea" : "dialog-input";
  input.value = initial || "";
  const btns = document.createElement("div");
  btns.className = "dialog-btns";
  const cancel = document.createElement("button");
  cancel.className = "btn secondary";
  cancel.textContent = "取消";
  const ok = document.createElement("button");
  ok.className = "btn";
  ok.textContent = "确定";
  cancel.onclick = () => mask.remove();
  ok.onclick = () => { onOk(input.value); mask.remove(); };
  btns.appendChild(cancel);
  btns.appendChild(ok);
  dlg.appendChild(h);
  dlg.appendChild(input);
  dlg.appendChild(btns);
  mask.appendChild(dlg);
  document.body.appendChild(mask);
  input.focus();
}

function confirmDialog(title, onOk) {
  const mask = document.createElement("div");
  mask.className = "dialog-mask";
  const dlg = document.createElement("div");
  dlg.className = "dialog";
  const h = document.createElement("div");
  h.className = "dialog-title";
  h.textContent = title;
  const btns = document.createElement("div");
  btns.className = "dialog-btns";
  const cancel = document.createElement("button");
  cancel.className = "btn secondary";
  cancel.textContent = "取消";
  const ok = document.createElement("button");
  ok.className = "btn danger";
  ok.textContent = "确定";
  cancel.onclick = () => mask.remove();
  ok.onclick = () => { onOk(); mask.remove(); };
  btns.appendChild(cancel);
  btns.appendChild(ok);
  dlg.appendChild(h);
  dlg.appendChild(btns);
  mask.appendChild(dlg);
  document.body.appendChild(mask);
}
/* ---------- 构建请求 ---------- */
function buildMessages(uptoId) {
  const r = curRole();
  const s = curSession();
  const msgs = [];

  let sys = r.systemPrompt || "";
  const mems = r.memories.filter(m => m.checked).map(m => m.text);
  if (mems.length) {
    sys += NL + NL + "[记忆]" + NL + mems.map((t, i) => (i + 1) + ". " + t).join(NL);
  }
  if (state.settings.splitSend) {
    sys += NL + NL + "[输出要求]请把回复自然地分成多个段落，每段之间用空行隔开，像连续发多条消息一样，总段数不超过" + state.settings.splitMax + "段。";
  }
  if (sys.trim()) msgs.push({ role: "system", content: sys });

  let history = s.messages;
  if (uptoId) {
    const idx = history.findIndex(m => m.id === uptoId);
    if (idx >= 0) history = history.slice(0, idx);
  }
  let lastImgId = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user" && history[i].img) {
      lastImgId = history[i].id;
      break;
    }
  }
  const count = state.settings.contextCount || 20;
  history = history.slice(-count);

  history.forEach(m => {
    const role = m.role === "user"? "user" : "assistant";
    if (m.id === lastImgId && m.img) {
      msgs.push({
        role: role,
        content: [
          { type: "image_url", image_url: { url: m.img } },
          { type: "text", text: msgText(m) || "（图片）" }
        ]
      });
    } else {
      msgs.push({ role: role, content: msgText(m) });
    }
  });
  return msgs;
}

/* ---------- 流式请求 ---------- */
async function streamChat(messages, onDelta) {
  const p = curProvider();
  if (!p.baseURL ||!p.apiKey) throw new Error("请先在设置里配置供应商地址和Key");
  if (!p.model) throw new Error("请先选择模型");

  const url = p.baseURL.replace(/\/+$/, "") + "/chat/completions";
  abortCtrl = new AbortController();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + p.apiKey
    },
    body: JSON.stringify({
      model: p.model,
      messages: messages,
      temperature: Number(state.settings.temperature),
      stream: true,
      stream_options: { include_usage: true }
    }),
    signal: abortCtrl.signal
  });

  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch (e) {}
    throw new Error("请求失败 " + res.status + " " + detail.slice(0, 300));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let usage = null;

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    const lines = buf.split(NL);
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const j = JSON.parse(data);
        const delta = j.choices && j.choices[0] && j.choices[0].delta;
        if (delta && delta.content) onDelta(delta.content);
        if (j.usage && j.usage.total_tokens) usage = j.usage.total_tokens;
      } catch (e) {}
    }
  }
  return usage;
}
/* ---------- 发送 ---------- */
async function sendMessage() {
  if (streaming) return;
  const input = $("#input-text");
  const text = input.value.trim();
  if (!text &&!pendingImg) return;

  const s = curSession();
  const userMsg = {
    id: uid(), role: "user",
    versions: [text || "（图片）"], vi: 0,
    time: Date.now()
  };
  if (pendingImg) {
    userMsg.img = pendingImg;
    pendingImg = null;
    renderAttachPreview();
  }
  s.messages.push(userMsg);

  if (s.name === "新对话" && text) {
    s.name = text.slice(0, 16);
  }

  input.value = "";
  input.style.height = "auto";
  saveState();
  await renderMessages();
  renderSidebar();

  const aiMsg = {
    id: uid(), role: "ai",
    versions: [""], vi: 0,
    time: Date.now(), tokens: null
  };
  s.messages.push(aiMsg);
  await runStream(aiMsg, buildMessages(aiMsg.id));
}

/* ---------- 重roll ---------- */
async function regenerate(m) {
  if (streaming) return;
  m.versions.push("");
  m.vi = m.versions.length - 1;
  await runStream(m, buildMessages(m.id));
}

/* ---------- 流式执行 ---------- */
async function runStream(aiMsg, messages) {
  streaming = true;
  $("#send-btn").disabled = true;
  saveState();
  await renderMessages();

  const row = document.querySelector('.msg-row[data-id="' + aiMsg.id + '"]');
  const txtEl = row? row.querySelector(".msg-txt") : null;
  const bubbleEl = row? row.querySelector(".msg-bubble") : null;
  if (bubbleEl) bubbleEl.classList.add("typing-cursor");
  const area = $("#chat-area");

  try {
    const usage = await streamChat(messages, (chunk) => {
      aiMsg.versions[aiMsg.vi] += chunk;
      if (txtEl) {
        txtEl.textContent = aiMsg.versions[aiMsg.vi];
        area.scrollTop = area.scrollHeight;
      }
    });
    if (usage) aiMsg.tokens = usage;
    if (!aiMsg.versions[aiMsg.vi]) {
      aiMsg.versions[aiMsg.vi] = "(空回复)";
    }
    if (state.settings.splitSend) {
      splitAiMessage(aiMsg);
    }
  } catch (e) {
    if (e.name === "AbortError") {
      toast("已停止生成");
    } else {
      toast(e.message, 6000);
      if (!aiMsg.versions[aiMsg.vi]) {
        if (aiMsg.versions.length > 1) {
          aiMsg.versions.pop();
          aiMsg.vi = aiMsg.versions.length - 1;
        } else {
          const s = curSession();
          s.messages = s.messages.filter(x => x.id!== aiMsg.id);
        }
      }
    }
  } finally {
    streaming = false;
    abortCtrl = null;
    $("#send-btn").disabled = false;
    if (bubbleEl) bubbleEl.classList.remove("typing-cursor");
    saveState();
    await renderMessages();
  }
}

/* ---------- 分段：把AI回复按空行拆成多条 ---------- */
function splitAiMessage(aiMsg) {
  if (aiMsg.versions.length > 1) return;
  const full = aiMsg.versions[aiMsg.vi];
  const parts = full.split(NL + NL).map(p => p.trim()).filter(p => p);
  if (parts.length < 2) return;
  const max = state.settings.splitMax || 20;
  const use = parts.slice(0, max);
  if (parts.length > max) {
    use[use.length - 1] = parts.slice(max - 1).join(NL + NL);
  }
  const s = curSession();
  const idx = s.messages.findIndex(x => x.id === aiMsg.id);
  if (idx < 0) return;
  const newMsgs = use.map((p, i) => ({
    id: uid(), role: "ai",
    versions: [p], vi: 0,
    time: aiMsg.time + i,
    tokens: i === use.length - 1? aiMsg.tokens : null
  }));
  s.messages.splice(idx, 1,...newMsgs);
}

/* ---------- 发图 ---------- */
function renderAttachPreview() {
  const box = $("#attach-preview");
  box.innerHTML = "";
  if (pendingImg) {
    box.classList.add("show");
    const wrap = document.createElement("div");
    wrap.className = "attach-thumb";
    const im = document.createElement("img");
    im.className = "attach-thumb-img";
    im.src = pendingImg;
    const del = document.createElement("button");
    del.className = "attach-del";
    del.textContent = "✕";
    del.onclick = () => {
      pendingImg = null;
      renderAttachPreview();
    };
    wrap.appendChild(im);
    wrap.appendChild(del);
    box.appendChild(wrap);
  } else {
    box.classList.remove("show");
  }
}

async function pickImage(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    pendingImg = await compressImage(file);
    renderAttachPreview();
  } catch (err) {
    toast(err.message);
  }
  e.target.value = "";
}
/* ---------- DOM小工具 ---------- */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text!== undefined) e.textContent = text;
  return e;
}

/* ---------- 侧边栏 ---------- */
function openSidebar() {
  $("#sidebar").classList.add("open");
  $("#sidebar-mask").classList.add("show");
}

function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#sidebar-mask").classList.remove("show");
}

function renderSidebar() {
  const list = $("#session-list");
  const r = curRole();
  list.innerHTML = "";
  r.sessions.forEach(s => {
    const div = el("div", "session-item" + (s.id === r.currentSessionId? " active" : ""), s.name);
    div.onclick = () => {
      r.currentSessionId = s.id;
      saveState();
      renderAll();
      closeSidebar();
    };
    bindLongPress(div, (x, y) => {
      showActions([
        { label: "重命名", fn: () => inputDialog("重命名会话", s.name, v => {
            if (v.trim()) { s.name = v.trim(); saveState(); renderSidebar(); }
          }) },
        { label: "删除", danger: true, fn: () => confirmDialog("删除这个会话？", () => {
            r.sessions = r.sessions.filter(x2 => x2.id!== s.id);
            if (!r.sessions.length) r.sessions.push({ id: uid(), name: "新对话", messages: [] });
            if (r.currentSessionId === s.id) r.currentSessionId = r.sessions[0].id;
            saveState();
            renderAll();
          }) }
      ], x, y);
    });
    list.appendChild(div);
  });
  $("#topbar-title").textContent = curSession().name;
  $("#current-role-name").textContent = r.name;
  avatarSrc("ai").then(src => { $("#current-role-avatar").src = src; });
}

function newSession() {
  const r = curRole();
  const s = { id: uid(), name: "新对话", messages: [] };
  r.sessions.unshift(s);
  r.currentSessionId = s.id;
  saveState();
  renderAll();
  closeSidebar();
}

/* ---------- 面板 ---------- */
function openPanel(id) { $(id).classList.add("open"); }
function closePanel(id) { $(id).classList.remove("open"); }

/* ---------- 相识页 ---------- */
function fillDaysPanel() {
  $("#days-num").textContent = loveDays();
  $("#days-date").textContent = "自 2026.06.07 起";
}

/* ---------- 角色页 ---------- */
function renderRolePage() {
  const list = $("#role-page-list");
  list.innerHTML = "";
  state.roles.forEach(r => {
    const div = el("div", "list-item" + (r.id === state.currentRoleId? " active" : ""));
    const img = el("img", "list-avatar");
    getImg(r.id + "_ai").then(blob => {
      img.src = blob? URL.createObjectURL(blob) : AI_FALLBACK;
    });
    const info = el("div", "list-info");
    info.appendChild(el("div", "list-name", r.name));
    info.appendChild(el("div", "list-desc", r.sessions.length + "个会话 · " + r.memories.length + "条记忆"));
    const more = el("span", "item-more", "⋯");
    info.onclick = () => {
      state.currentRoleId = r.id;
      saveState();
      clearUrlCache();
      renderAll();
      applyBg();
      renderRolePage();
      toast("已切换到 " + r.name);
    };
    more.onclick = (e) => {
      e.stopPropagation();
      showActions([
        { label: "重命名", fn: () => inputDialog("角色名", r.name, v => {
            if (v.trim()) { r.name = v.trim(); saveState(); renderRolePage(); renderSidebar(); }
          }) },
        { label: "删除", danger: true, fn: () => {
            if (state.roles.length <= 1) { toast("至少保留一个角色"); return; }
            confirmDialog("删除角色和它的全部数据？", () => {
              ["_ai", "_user", "_bg"].forEach(sf => delImg(r.id + sf));
              state.roles = state.roles.filter(x => x.id!== r.id);
              if (state.currentRoleId === r.id) state.currentRoleId = state.roles[0].id;
              saveState();
              clearUrlCache();
              renderAll();
              applyBg();
              renderRolePage();
            });
          } }
      ], e.clientX, e.clientY);
    };
    div.appendChild(img);
    div.appendChild(info);
    div.appendChild(more);
    list.appendChild(div);
  });
}

function newRole() {
  inputDialog("新角色名字", "", v => {
    if (!v.trim()) return;
    const sessionId = uid();
    const r = {
      id: uid(), name: v.trim(),
      systemPrompt: "", aiName: "Claude", userName: "我",
      currentSessionId: sessionId,
      sessions: [{ id: sessionId, name: "新对话", messages: [] }],
      memories: []
    };
    state.roles.push(r);
    state.currentRoleId = r.id;
    saveState();
    clearUrlCache();
    renderAll();
    applyBg();
    renderRolePage();
  });
}

/* ---------- 供应商 ---------- */
function renderProviders() {
  const list = $("#provider-list");
  list.innerHTML = "";
  state.settings.providers.forEach(p => {
    const div = el("div", "list-item" + (p.id === state.settings.currentProviderId? " active" : ""));
    const info = el("div", "list-info");
    info.appendChild(el("div", "list-name", p.name));
    info.appendChild(el("div", "list-desc", (p.baseURL || "未配置") + " · " + p.models.length + "个模型"));
    const more = el("span", "item-more", "⋯");
    info.onclick = () => {
      state.settings.currentProviderId = p.id;
      saveState();
      renderProviders();
      fillProviderForm();
      renderModelBtn();
      toast("已切换到 " + p.name);
    };
    more.onclick = (e) => {
      e.stopPropagation();
      showActions([
        { label: "重命名", fn: () => inputDialog("供应商名字", p.name, v => {
            if (v.trim()) { p.name = v.trim(); saveState(); renderProviders(); }
          }) },
        { label: "删除", danger: true, fn: () => {
            if (state.settings.providers.length <= 1) { toast("至少保留一个供应商"); return; }
            confirmDialog("删除这个供应商？", () => {
              state.settings.providers = state.settings.providers.filter(x => x.id!== p.id);
              if (state.settings.currentProviderId === p.id) {
                state.settings.currentProviderId = state.settings.providers[0].id;
              }
              saveState();
              renderProviders();
              fillProviderForm();
              renderModelBtn();
            });
          } }
      ], e.clientX, e.clientY);
    };
    div.appendChild(info);
    div.appendChild(more);
    list.appendChild(div);
  });
}

function newProvider() {
  inputDialog("供应商名字", "", v => {
    if (!v.trim()) return;
    const p = { id: uid(), name: v.trim(), baseURL: "", apiKey: "", models: [], model: "" };
    state.settings.providers.push(p);
    state.settings.currentProviderId = p.id;
    saveState();
    renderProviders();
    fillProviderForm();
    renderModelBtn();
  });
}

function fillProviderForm() {
  const p = curProvider();
  $("#set-baseurl").value = p.baseURL;
  $("#set-apikey").value = p.apiKey;
  renderModelSelect();
}

async function fetchModels() {
  const p = curProvider();
  p.baseURL = $("#set-baseurl").value.trim();
  p.apiKey = $("#set-apikey").value.trim();
  if (!p.baseURL ||!p.apiKey) { toast("先填地址和Key"); return; }
  toast("拉取中...");
  try {
    const url = p.baseURL.replace(/\/+$/, "") + "/models";
    const res = await fetch(url, { headers: { "Authorization": "Bearer " + p.apiKey } });
    if (!res.ok) throw new Error("拉取失败 " + res.status);
    const j = await res.json();
    const ids = (j.data || []).map(m => m.id).sort();
    if (!ids.length) throw new Error("没有拉到模型");
    p.models = ids;
    if (!p.model ||!ids.includes(p.model)) p.model = ids[0];
    saveState();
    renderModelSelect();
    renderModelBtn();
    renderProviders();
    toast("拉到 " + ids.length + " 个模型");
  } catch (e) {
    toast(e.message, 5000);
  }
}

function renderModelSelect() {
  const p = curProvider();
  const sel = $("#set-model");
  sel.innerHTML = "";
  p.models.forEach(id => {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = id;
    if (id === p.model) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => {
    p.model = sel.value;
    saveState();
    renderModelBtn();
  };
}

function renderModelBtn() {
  $("#model-btn").textContent = curProvider().model || "选择模型";
}

function toggleModelPopup() {
  const pop = $("#model-popup");
  if (pop.classList.contains("show")) {
    pop.classList.remove("show");
    return;
  }
  const p = curProvider();
  if (!p.models.length) { toast("先去设置里拉取模型列表"); return; }
  pop.innerHTML = "";
  p.models.forEach(id => {
    const div = el("div", "model-item" + (id === p.model? " selected" : ""), id);
    div.onclick = () => {
      p.model = id;
      saveState();
      renderModelBtn();
      pop.classList.remove("show");
    };
    pop.appendChild(div);
  });
  pop.classList.add("show");
}
/* ---------- 控件工厂 ---------- */
function mkSection(parent, title) {
  const sec = el("div", "settings-section");
  sec.appendChild(el("div", "section-title", title));
  parent.appendChild(sec);
  return sec;
}

function mkSeg(parent, opts, getV, setV) {
  const g = el("div", "seg-group");
  opts.forEach(o => {
    const b = el("button", "seg-btn", o.name);
    b._v = o.v;
    b.onclick = () => { setV(o.v); refresh(); };
    g.appendChild(b);
  });
  function refresh() {
    Array.from(g.children).forEach(b => b.classList.toggle("on", b._v === getV()));
  }
  refresh();
  parent.appendChild(g);
  return refresh;
}

function mkSlider(parent, label, min, max, step, key, unit, after) {
  const rowEl = el("div", "slider-row");
  const head = el("div", "slider-head");
  head.appendChild(el("span", "", label));
  const val = el("span", "slider-val", state.settings[key] + unit);
  head.appendChild(val);
  const sl = document.createElement("input");
  sl.type = "range";
  sl.min = min;
  sl.max = max;
  sl.step = step;
  sl.value = state.settings[key];
  sl.addEventListener("input", () => {
    state.settings[key] = Number(sl.value);
    val.textContent = sl.value + unit;
    saveState();
    if (after) after();
  });
  rowEl.appendChild(head);
  rowEl.appendChild(sl);
  parent.appendChild(rowEl);
}

function mkDots(parent, key) {
  const box = el("div", "color-dots");
  Object.keys(BUBBLE_COLORS).forEach(k => {
    const d = el("div", "color-dot");
    const c = BUBBLE_COLORS[k];
    d.style.background = k === "glass"? "linear-gradient(135deg, rgba(255,255,255,0.95), rgba(190,190,190,0.3))"
      : c.bg;
    d._k = k;
    d.onclick = () => {
      state.settings[key] = k;
      saveState();
      renderMessages();
      refresh();
    };
    box.appendChild(d);
  });
  function refresh() {
    Array.from(box.children).forEach(d => d.classList.toggle("on", d._k === state.settings[key]));
  }
  refresh();
  parent.appendChild(box);
}

function mkFontSelect(parent, label, key, after) {
  const row = el("div", "form-row");
  const lb = el("label", "form-label", label);
  row.appendChild(lb);
  const sel = document.createElement("select");
  sel.className = "form-select";
  Object.keys(FONT_NAMES).forEach(k => {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = FONT_NAMES[k];
    if (state.settings[key] === k) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => {
    state.settings[key] = sel.value;
    saveState();
    if (after) after();
  };
  row.appendChild(sel);
  parent.appendChild(row);
}

/* ---------- 主题页 ---------- */
function buildThemePanel() {
  const body = $("#theme-body");
  body.innerHTML = "";

  let sec = mkSection(body, "模式");
  mkSeg(sec,
    [{ v: false, name: "白天" }, { v: true, name: "夜间" }],
    () => state.settings.darkMode,
    (v) => { state.settings.darkMode = v; saveState(); applyTheme(); renderMessages(); }
  );

  sec = mkSection(body, "侧边栏");
  mkSeg(sec,
    [{ v: "white", name: "纯白" }, { v: "glass", name: "毛玻璃" }, { v: "clear", name: "高透液态" }],
    () => state.settings.sidebarStyle,
    (v) => { state.settings.sidebarStyle = v; saveState(); applyTheme(); }
  );
  mkSlider(sec, "透明度", 10, 100, 1, "sidebarAlpha", "%", applyTheme);

  sec = mkSection(body, "气泡");
  sec.appendChild(el("label", "form-label", "质感"));
  mkSeg(sec,
    [{ v: "water", name: "水感液态" }, { v: "plain", name: "素面" }],
    () => state.settings.bubbleTexture,
    (v) => { state.settings.bubbleTexture = v; saveState(); renderMessages(); }
  );
  sec.appendChild(el("label", "form-label", "AI消息"));
  mkSeg(sec,
    [{ v: false, name: "有气泡" }, { v: true, name: "无气泡" }],
    () => state.settings.aiBare,
    (v) => { state.settings.aiBare = v; saveState(); renderMessages(); }
  );
  sec.appendChild(el("label", "form-label", "形状"));
  mkSeg(sec,
    Object.keys(BUBBLE_SHAPES).map(k => ({ v: k, name: BUBBLE_SHAPES[k].name })),
    () => state.settings.bubbleShape,
    (v) => { state.settings.bubbleShape = v; saveState(); renderMessages(); }
  );
  sec.appendChild(el("label", "form-label", "我的气泡颜色"));
  mkDots(sec, "userBubbleColor");
  sec.appendChild(el("label", "form-label", "AI气泡颜色"));
  mkDots(sec, "aiBubbleColor");

  sec = mkSection(body, "字体");
  mkFontSelect(sec, "聊天字体", "chatFont", applyTheme);
  mkFontSelect(sec, "界面字体", "uiFont", applyTheme);
  mkFontSelect(sec, "小字字体（昵称 时间 token）", "metaFont", () => renderMessages());
  mkSlider(sec, "昵称粗细", 200, 700, 100, "nameWeight", "", () => renderMessages());
  mkSlider(sec, "小字大小", 8, 14, 1, "metaSize", "px", () => renderMessages());
  mkSlider(sec, "小字粗细", 200, 700, 100, "metaWeight", "", () => renderMessages());
  mkSlider(sec, "小字深浅（越小越黑）", 80, 210, 5, "metaShade", "", () => renderMessages());
}

/* ---------- 设置页的参数和分段 ---------- */
function buildSettingsExtras() {
  const pb = $("#param-body");
  pb.innerHTML = "";
  mkSlider(pb, "聊天字体大小", 10, 24, 1, "fontSize", "px", applyTheme);
  mkSlider(pb, "temperature", 0, 2, 0.1, "temperature", "", null);
  mkSlider(pb, "携带上下文条数", 1, 100, 1, "contextCount", "条", null);

  const sb = $("#split-body");
  sb.innerHTML = "";
  mkSeg(sb,
    [{ v: false, name: "关闭" }, { v: true, name: "开启" }],
    () => state.settings.splitSend,
    (v) => { state.settings.splitSend = v; saveState(); }
  );
  mkSlider(sb, "分段上限", 2, 20, 1, "splitMax", "段", null);
}
/* ---------- 设置页 ---------- */
function fillSettingsPanel() {
  fillProviderForm();
  renderProviders();
  const r = curRole();
  $("#set-ainame").value = r.aiName;
  $("#set-username").value = r.userName;
  $("#set-sysprompt").value = r.systemPrompt;
  renderMemories();
  avatarSrc("ai").then(src => { $("#preview-ai-avatar").src = src; });
  avatarSrc("user").then(src => { $("#preview-user-avatar").src = src; });
}

function saveSettingsForm() {
  const r = curRole();
  const p = curProvider();
  p.baseURL = $("#set-baseurl").value.trim();
  p.apiKey = $("#set-apikey").value.trim();
  r.aiName = $("#set-ainame").value.trim() || "Claude";
  r.userName = $("#set-username").value.trim() || "我";
  r.systemPrompt = $("#set-sysprompt").value;
  saveState();
  toast("已保存");
  renderAll();
  renderProviders();
}

/* ---------- 记忆 ---------- */
function renderMemories() {
  const list = $("#memory-list");
  const r = curRole();
  list.innerHTML = "";
  r.memories.forEach(m => {
    const div = el("div", "memory-item");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "memory-check";
    cb.checked =!!m.checked;
    cb.onchange = () => { m.checked = cb.checked; saveState(); };
    const txt = el("div", "memory-text", m.text);
    const ops = el("div", "memory-ops");
    const eb = el("button", "mem-btn", "编辑");
    eb.onclick = () => inputDialog("编辑记忆", m.text, v => {
      if (v.trim()) { m.text = v.trim(); saveState(); renderMemories(); }
    }, true);
    const db2 = el("button", "mem-btn", "删除");
    db2.onclick = () => confirmDialog("删除这条记忆？", () => {
      r.memories = r.memories.filter(x => x.id!== m.id);
      saveState();
      renderMemories();
    });
    ops.appendChild(eb);
    ops.appendChild(db2);
    div.appendChild(cb);
    div.appendChild(txt);
    div.appendChild(ops);
    list.appendChild(div);
  });
}

function newMemory() {
  inputDialog("新记忆", "", v => {
    if (!v.trim()) return;
    curRole().memories.push({ id: uid(), text: v.trim(), checked: true });
    saveState();
    renderMemories();
  }, true);
}

/* ---------- 上传 ---------- */
function bindImgUpload(inputSel, key, after) {
  $(inputSel).addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await putImg(curRole().id + key, file);
    clearUrlCache();
    if (after) after();
    e.target.value = "";
    toast("已上传");
  });
}

/* ---------- 导出导入 ---------- */
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "home_backup_" + Date.now() + ".json";
  a.click();
  toast("已导出");
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const j = JSON.parse(reader.result);
      if (!j.roles ||!j.settings) throw new Error("文件格式不对");
      state = j;
      fillDefaults();
      saveState();
      clearUrlCache();
      applyTheme();
      applyBg();
      renderAll();
      toast("导入成功");
    } catch (err) {
      toast("导入失败：" + err.message, 5000);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

let exportMode = false;

function toggleExportMode() {
  exportMode =!exportMode;
  document.body.classList.toggle("export-mode", exportMode);
  $("#export-txt-bar").classList.toggle("show", exportMode);
  document.querySelectorAll(".msg-check").forEach(c => {
    c.style.display = exportMode? "block" : "none";
    if (!exportMode) c.checked = false;
  });
  closePanel("#settings-panel");
}

function doExportTxt() {
  const s = curSession();
  const r = curRole();
  const ids = Array.from(document.querySelectorAll(".msg-check")).filter(c => c.checked).map(c => c.dataset.id);
  const msgs = ids.length? s.messages.filter(m => ids.includes(m.id)) : s.messages;
  if (!msgs.length) { toast("没有可导出的消息"); return; }
  const lines = msgs.map(m => {
    const name = m.role === "user"? r.userName : r.aiName;
    return "[" + fmtTime(m.time) + "] " + name + "：" + NL + msgText(m) + NL;
  });
  const blob = new Blob([lines.join(NL)], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = s.name + ".txt";
  a.click();
  toggleExportMode();
  toast("已导出TXT");
}

/* ---------- 总渲染 ---------- */
async function renderAll() {
  renderSidebar();
  renderModelBtn();
  await renderMessages();
}

/* ---------- 事件 ---------- */
function bindEvents() {
  $("#menu-btn").onclick = openSidebar;
  $("#sidebar-mask").onclick = closeSidebar;
  $("#new-session-btn").onclick = newSession;

  $("#menu-theme").onclick = () => openPanel("#theme-panel");
  $("#menu-role").onclick = () => { renderRolePage(); openPanel("#role-panel"); };
  $("#menu-days").onclick = () => { fillDaysPanel(); openPanel("#days-panel"); };
  $("#settings-btn").onclick = () => { fillSettingsPanel(); openPanel("#settings-panel"); };
  $("#sidebar-role").onclick = () => { fillSettingsPanel(); openPanel("#settings-panel"); };

  $("#theme-back").onclick = () => closePanel("#theme-panel");
  $("#role-back").onclick = () => closePanel("#role-panel");
  $("#days-back").onclick = () => closePanel("#days-panel");
  $("#settings-back").onclick = () => closePanel("#settings-panel");

  $("#send-btn").onclick = sendMessage;
  $("#model-btn").onclick = toggleModelPopup;
  $("#attach-btn").onclick = () => $("#attach-input").click();
  $("#attach-input").addEventListener("change", pickImage);

  const input = $("#input-text");
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  $("#save-settings-btn").onclick = saveSettingsForm;
  $("#fetch-models-btn").onclick = fetchModels;
  $("#new-provider-btn").onclick = newProvider;
  $("#new-role-btn").onclick = newRole;
  $("#new-memory-btn").onclick = newMemory;

  bindImgUpload("#upload-ai-avatar", "_ai", () => { fillSettingsPanel(); renderAll(); });
  bindImgUpload("#upload-user-avatar", "_user", () => { fillSettingsPanel(); renderAll(); });
  bindImgUpload("#upload-bg", "_bg", applyBg);
  $("#remove-bg-btn").onclick = async () => {
    await delImg(curRole().id + "_bg");
    applyBg();
    toast("背景已移除");
  };

  $("#export-json-btn").onclick = exportData;
  $("#import-json-input").addEventListener("change", importData);
  $("#export-txt-btn").onclick = toggleExportMode;
  $("#export-txt-confirm").onclick = doExportTxt;
  $("#export-txt-cancel").onclick = toggleExportMode;

  document.addEventListener("click", (e) => {
    const pop = $("#model-popup");
    if (pop.classList.contains("show") &&!pop.contains(e.target) && e.target.id!== "model-btn") {
      pop.classList.remove("show");
    }
  });
}

/* ---------- 启动 ---------- */
async function init() {
  loadState();
  await openDB();
  injectDynStyle();
  applyTheme();
  await applyBg();
  buildThemePanel();
  buildSettingsExtras();
  bindEvents();
  await renderAll();
}

init();

