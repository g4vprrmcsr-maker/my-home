/* ============================================
   小家 app.js v2
   ============================================ */

const LS_KEY = "home_data_v2";
const OLD_KEY = "home_data_v1";
const NL = String.fromCharCode(10);
const LOVE_START = new Date(2026, 5, 7); // 2026年6月7日，月份从0数

let DB = null;
let state = null;
let streaming = false;
let abortCtrl = null;
let pendingImg = null; // 待发送的图片 dataURL

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaultState() {
  const roleId = uid();
  const sessionId = uid();
  const provId = uid();
  return {
    settings: {
      providers: [{ id: provId, name: "默认供应商", baseURL: "", apiKey: "", models: [], model: "" }],
      currentProviderId: provId,
      temperature: 1,
      contextCount: 20,
      fontSize: 14,
      theme: "white",
      sidebarAlpha: 72,
      bubbleMode: "bubble"   // bubble | none
    },
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

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      state = JSON.parse(raw);
      return;
    }
    /* 迁移旧版数据，会话记忆一条不丢 */
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      const o = JSON.parse(old);
      state = defaultState();
      if (o.roles && o.roles.length) {
        state.roles = o.roles;
        state.currentRoleId = o.currentRoleId || o.roles[0].id;
      }
      if (o.settings) {
        const p = state.settings.providers[0];
        p.baseURL = o.settings.baseURL || "";
        p.apiKey = o.settings.apiKey || "";
        p.models = o.settings.models || [];
        p.model = o.settings.model || "";
        state.settings.temperature = o.settings.temperature || 1;
        state.settings.contextCount = o.settings.contextCount || 20;
        state.settings.fontSize = o.settings.fontSize || 14;
        state.settings.theme = o.settings.theme || "white";
      }
      saveState();
      return;
    }
    state = defaultState();
  } catch (e) {
    state = defaultState();
  }
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
/* ---------- 快捷取值 ---------- */
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

/* ---------- 小工具 ---------- */
function $(sel) { return document.querySelector(sel); }

function esc(s) {
  return String(s).replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
}

function toast(msg, ms = 3000) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), ms);
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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

/* ---------- 背景与主题 ---------- */
async function applyBg() {
  const bgEl = $("#chat-bg");
  const blob = await getImg(curRole().id + "_bg");
  if (blob) {
    bgEl.style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
    bgEl.classList.add("has-bg");
  } else {
    bgEl.style.backgroundImage = "";
    bgEl.classList.remove("has-bg");
  }
}

function applyTheme() {
  const st = state.settings;
  document.body.classList.toggle("theme-glass", st.theme === "glass");
  document.body.classList.toggle("no-bubble", st.bubbleMode === "none");
  document.documentElement.style.setProperty("--sidebar-alpha", (st.sidebarAlpha || 72) / 100);
  document.documentElement.style.setProperty("--msg-fs", (st.fontSize || 14) + "px");
}

/* ---------- 图片压缩 ---------- */
function compressImage(file, maxSide = 1024, quality = 0.8) {
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
/* ---------- 操作菜单 ---------- */
function showActions(items, x, y) {
  closeActions();
  const menu = document.createElement("div");
  menu.className = "msg-actions";
  items.forEach(it => {
    const b = document.createElement("button");
    b.textContent = it.label;
    if (it.danger) b.classList.add("danger");
    b.onclick = () => { closeActions(); it.fn(); };
    menu.appendChild(b);
  });
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + "px";
  setTimeout(() => {
    document.addEventListener("click", closeActions, { once: true });
    document.addEventListener("touchstart", closeActions, { once: true });
  }, 50);
}

function closeActions() {
  document.querySelectorAll(".msg-actions").forEach(m => m.remove());
}

/* ---------- 长按绑定工具 ---------- */
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
  el.addEventListener("touchend", (e) => {
    if (timer === null &&!moved) e.preventDefault();
    clearTimeout(timer);
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    fn(e.clientX, e.clientY);
  });
}

/* ---------- 通用弹窗 ---------- */
function inputDialog(title, initial, onOk, multiline) {
  const mask = document.createElement("div");
  mask.className = "dialog-mask";
  mask.innerHTML = `
    <div class="dialog">
      <h3>${esc(title)}</h3>
      ${multiline? `<textarea id="dlg-input">${esc(initial || "")}</textarea>`
        : `<input id="dlg-input" type="text" value="${esc(initial || "")}">`}
      <div class="dialog-btns">
        <button class="btn secondary" id="dlg-cancel">取消</button>
        <button class="btn" id="dlg-ok">确定</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  const input = mask.querySelector("#dlg-input");
  input.focus();
  mask.querySelector("#dlg-cancel").onclick = () => mask.remove();
  mask.querySelector("#dlg-ok").onclick = () => {
    onOk(input.value);
    mask.remove();
  };
}

function confirmDialog(title, onOk) {
  const mask = document.createElement("div");
  mask.className = "dialog-mask";
  mask.innerHTML = `
    <div class="dialog">
      <h3>${esc(title)}</h3>
      <div class="dialog-btns">
        <button class="btn secondary" id="dlg-cancel">取消</button>
        <button class="btn danger" id="dlg-ok">确定</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  mask.querySelector("#dlg-cancel").onclick = () => mask.remove();
  mask.querySelector("#dlg-ok").onclick = () => { onOk(); mask.remove(); };
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
    const div = document.createElement("div");
    div.className = "session-item" + (s.id === r.currentSessionId? " active" : "");
    div.textContent = s.name;
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
    const row = document.createElement("div");
    row.className = "msg-row " + (m.role === "user"? "user" : "ai");
    row.dataset.id = m.id;

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "msg-check";
    check.dataset.id = m.id;

    const avatar = document.createElement("img");
    avatar.className = "msg-avatar";
    avatar.src = m.role === "user"? userSrc : aiSrc;

    const body = document.createElement("div");
    body.className = "msg-body";

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.innerHTML = `<span class="msg-name">${esc(m.role === "user"? r.userName : r.aiName)}</span><span>${fmtTime(m.time)}</span>`;

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    if (m.img) {
      const im = document.createElement("img");
      im.className = "msg-img";
      im.src = m.img;
      bubble.appendChild(im);
    }
    const txtNode = document.createElement("span");
    txtNode.textContent = msgText(m);
    bubble.appendChild(txtNode);

    const footer = document.createElement("div");
    footer.className = "msg-footer";

    if (m.role === "ai" && m.versions.length > 1) {
      const vs = document.createElement("div");
      vs.className = "version-switch";
      vs.innerHTML = `<button data-d="-1">‹</button><span>${m.vi + 1}/${m.versions.length}</span><button data-d="1">›</button>`;
      vs.querySelectorAll("button").forEach(b => {
        b.onclick = (e) => {
          e.stopPropagation();
          const d = parseInt(b.dataset.d);
          m.vi = Math.max(0, Math.min(m.versions.length - 1, m.vi + d));
          saveState();
          renderMessages();
        };
      });
      footer.appendChild(vs);
    }

    if (m.role === "ai" && m.tokens) {
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

    bindLongPress(bubble, (x, y) => msgMenu(m, x, y));
  });

  area.scrollTop = area.scrollHeight;
}

/* ---------- 消息菜单 ---------- */
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
  if (sys.trim()) msgs.push({ role: "system", content: sys });

  let history = s.messages;
  let lastImgId = null;
  if (uptoId) {
    const idx = history.findIndex(m => m.id === uptoId);
    if (idx >= 0) history = history.slice(0, idx);
  }
  /* 只有最后一条用户消息的图片会被发送 */
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
  if (!p.baseURL ||!p.apiKey) throw new Error("请先在设置里配置供应商的地址和Key");
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
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
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
      } catch (e) { /* 跳过坏行 */ }
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

  const row = document.querySelector(`.msg-row[data-id="${aiMsg.id}"]`);
  const bubble = row? row.querySelector(".msg-bubble span") : null;
  const bubbleBox = row? row.querySelector(".msg-bubble") : null;
  if (bubbleBox) bubbleBox.classList.add("typing-cursor");
  const area = $("#chat-area");

  try {
    const usage = await streamChat(messages, (chunk) => {
      aiMsg.versions[aiMsg.vi] += chunk;
      if (bubble) {
        bubble.textContent = aiMsg.versions[aiMsg.vi];
        area.scrollTop = area.scrollHeight;
      }
    });
    if (usage) aiMsg.tokens = usage;
    if (!aiMsg.versions[aiMsg.vi]) {
      aiMsg.versions[aiMsg.vi] = "(空回复)";
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
    if (bubbleBox) bubbleBox.classList.remove("typing-cursor");
    saveState();
    await renderMessages();
  }
}

/* ---------- 发图 ---------- */
function renderAttachPreview() {
  const box = $("#attach-preview");
  box.innerHTML = "";
  if (pendingImg) {
    box.classList.add("show");
    const wrap = document.createElement("div");
    wrap.className = "attach-thumb";
    wrap.innerHTML = `<img src="${pendingImg}"><button class="attach-del">✕</button>`;
    wrap.querySelector(".attach-del").onclick = () => {
      pendingImg = null;
      renderAttachPreview();
    };
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
/* ---------- 面板开关 ---------- */
function openPanel(id) {
  $(id).classList.add("open");
}

function closePanel(id) {
  $(id).classList.remove("open");
}

/* ---------- 主题页 ---------- */
function fillThemePanel() {
  const st = state.settings;
  document.querySelectorAll("#seg-theme button").forEach(b => {
    b.classList.toggle("on", b.dataset.v === st.theme);
  });
  document.querySelectorAll("#seg-bubble button").forEach(b => {
    b.classList.toggle("on", b.dataset.v === st.bubbleMode);
  });
  $("#sl-alpha").value = st.sidebarAlpha;
  $("#sl-alpha-val").textContent = st.sidebarAlpha + "%";
}

function bindThemePanel() {
  document.querySelectorAll("#seg-theme button").forEach(b => {
    b.onclick = () => {
      state.settings.theme = b.dataset.v;
      saveState();
      applyTheme();
      fillThemePanel();
    };
  });
  document.querySelectorAll("#seg-bubble button").forEach(b => {
    b.onclick = () => {
      state.settings.bubbleMode = b.dataset.v;
      saveState();
      applyTheme();
      fillThemePanel();
    };
  });
  $("#sl-alpha").addEventListener("input", (e) => {
    state.settings.sidebarAlpha = parseInt(e.target.value);
    $("#sl-alpha-val").textContent = state.settings.sidebarAlpha + "%";
    applyTheme();
    saveState();
  });
}

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
    const div = document.createElement("div");
    div.className = "role-list-item" + (r.id === state.currentRoleId? " active" : "");
    div.innerHTML = `
      <img>
      <div class="role-info">
        <div class="name">${esc(r.name)}</div>
        <div class="desc">${r.sessions.length}个会话 · ${r.memories.length}条记忆</div>
      </div>
      <span class="item-more">⋯</span>`;
    getImg(r.id + "_ai").then(blob => {
      div.querySelector("img").src = blob? URL.createObjectURL(blob) : AI_FALLBACK;
    });
    div.querySelector(".role-info").onclick = () => {
      state.currentRoleId = r.id;
      saveState();
      clearUrlCache();
      renderAll();
      applyBg();
      renderRolePage();
      toast("已切换到 " + r.name);
    };
    div.querySelector(".item-more").onclick = (e) => {
      e.stopPropagation();
      showActions([
        { label: "重命名", fn: () => inputDialog("角色名", r.name, v => {
            if (v.trim()) { r.name = v.trim(); saveState(); renderRolePage(); renderSidebar(); }
          }) },
        { label: "删除", danger: true, fn: () => {
            if (state.roles.length <= 1) { toast("至少保留一个角色"); return; }
            confirmDialog("删除角色「" + r.name + "」？会话和记忆都会没", () => {
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
    const div = document.createElement("div");
    div.className = "provider-item" + (p.id === state.settings.currentProviderId? " active" : "");
    div.innerHTML = `
      <div class="provider-info">
        <div class="name">${esc(p.name)}</div>
        <div class="desc">${esc(p.baseURL || "未配置")} · ${p.models.length}个模型</div>
      </div>
      <span class="item-more">⋯</span>`;
    div.querySelector(".provider-info").onclick = () => {
      state.settings.currentProviderId = p.id;
      saveState();
      renderProviders();
      fillProviderForm();
      renderModelBtn();
      toast("已切换到 " + p.name);
    };
    div.querySelector(".item-more").onclick = (e) => {
      e.stopPropagation();
      showActions([
        { label: "重命名", fn: () => inputDialog("供应商名字", p.name, v => {
            if (v.trim()) { p.name = v.trim(); saveState(); renderProviders(); }
          }) },
        { label: "删除", danger: true, fn: () => {
            if (state.settings.providers.length <= 1) { toast("至少保留一个供应商"); return; }
            confirmDialog("删除供应商「" + p.name + "」？", () => {
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
    const div = document.createElement("div");
    div.className = "model-item" + (id === p.model? " selected" : "");
    div.textContent = id;
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
/* ---------- 设置页 ---------- */
function fillSettingsPanel() {
  const r = curRole();
  fillProviderForm();
  renderProviders();
  $("#set-ainame").value = r.aiName;
  $("#set-username").value = r.userName;
  $("#set-sysprompt").value = r.systemPrompt;
  bindSliderVal("#sl-fontsize", "#sl-fontsize-val", state.settings.fontSize, "px");
  bindSliderVal("#sl-temp", "#sl-temp-val", state.settings.temperature, "");
  bindSliderVal("#sl-context", "#sl-context-val", state.settings.contextCount, "条");
  renderMemories();
  avatarSrc("ai").then(src => { $("#preview-ai-avatar").src = src; });
  avatarSrc("user").then(src => { $("#preview-user-avatar").src = src; });
}

function bindSliderVal(slSel, valSel, val, unit) {
  $(slSel).value = val;
  $(valSel).textContent = val + unit;
}

function bindSliders() {
  $("#sl-fontsize").addEventListener("input", (e) => {
    state.settings.fontSize = parseInt(e.target.value);
    $("#sl-fontsize-val").textContent = state.settings.fontSize + "px";
    applyTheme();
    saveState();
  });
  $("#sl-temp").addEventListener("input", (e) => {
    state.settings.temperature = parseFloat(e.target.value);
    $("#sl-temp-val").textContent = state.settings.temperature;
    saveState();
  });
  $("#sl-context").addEventListener("input", (e) => {
    state.settings.contextCount = parseInt(e.target.value);
    $("#sl-context-val").textContent = state.settings.contextCount + "条";
    saveState();
  });
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
    const div = document.createElement("div");
    div.className = "memory-item";
    div.innerHTML = `
      <input type="checkbox" ${m.checked? "checked" : ""}>
      <div class="memory-text">${esc(m.text)}</div>
      <div class="memory-ops">
        <button data-op="edit">编辑</button>
        <button data-op="del">删除</button>
      </div>`;
    div.querySelector("input").onchange = (e) => {
      m.checked = e.target.checked;
      saveState();
    };
    div.querySelector('[data-op="edit"]').onclick = () => {
      inputDialog("编辑记忆", m.text, v => {
        if (v.trim()) { m.text = v.trim(); saveState(); renderMemories(); }
      }, true);
    };
    div.querySelector('[data-op="del"]').onclick = () => {
      confirmDialog("删除这条记忆？", () => {
        r.memories = r.memories.filter(x => x.id!== m.id);
        saveState();
        renderMemories();
      });
    };
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
  toast("已导出（图片不含在内）");
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
      saveState();
      clearUrlCache();
      renderAll();
      applyTheme();
      applyBg();
      toast("导入成功");
    } catch (err) {
      toast("导入失败：" + err.message, 5000);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

/* ---------- 导出TXT ---------- */
let exportMode = false;

function toggleExportMode() {
  exportMode =!exportMode;
  document.body.classList.toggle("export-mode", exportMode);
  $("#export-txt-bar").classList.toggle("show", exportMode);
  if (!exportMode) {
    document.querySelectorAll(".msg-check").forEach(c => c.checked = false);
  }
  closePanel("#settings-panel");
}

function doExportTxt() {
  const s = curSession();
  const r = curRole();
  const ids = [...document.querySelectorAll(".msg-check:checked")].map(c => c.dataset.id);
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
/* ---------- 整体刷新 ---------- */
async function renderAll() {
  renderSidebar();
  renderModelBtn();
  await renderMessages();
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  $("#menu-btn").onclick = openSidebar;
  $("#sidebar-mask").onclick = closeSidebar;
  $("#new-session-btn").onclick = newSession;

  /* 菜单入口 */
  $("#menu-theme").onclick = () => { fillThemePanel(); openPanel("#theme-panel"); };
  $("#menu-role").onclick = () => { renderRolePage(); openPanel("#role-panel"); };
  $("#menu-days").onclick = () => { fillDaysPanel(); openPanel("#days-panel"); };
  $("#settings-btn").onclick = () => { fillSettingsPanel(); openPanel("#settings-panel"); };
  $("#sidebar-role").onclick = () => { fillSettingsPanel(); openPanel("#settings-panel"); };

  /* 面板返回 */
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

  bindThemePanel();
  bindSliders();

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
  applyTheme();
  await applyBg();
  bindEvents();
  await renderAll();
}

init();
/* ===== 修复补丁 v2.1：菜单点击失效 ===== */
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
    b.textContent = it.label;
    if (it.danger) b.classList.add("danger");
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
/* ===== 修复补丁 v2.2：主题直接上手焊 ===== */
function applyBubbleClasses() {
  const bare = state.settings.bubbleMode === "none";
  document.querySelectorAll(".msg-row.ai").forEach(row => {
    const b = row.querySelector(".msg-bubble");
    if (b) b.classList.toggle("ai-bare", bare);
  });
}

const _origRenderMessages = renderMessages;
renderMessages = async function () {
  await _origRenderMessages();
  applyBubbleClasses();
};

const _origApplyTheme = applyTheme;
applyTheme = function () {
  _origApplyTheme();
  const sb = document.getElementById("sidebar");
  if (state.settings.theme === "glass") {
    const a = (state.settings.sidebarAlpha || 72) / 100;
    sb.style.background = "rgba(255,255,255," + a + ")";
    sb.style.backdropFilter = "blur(24px) saturate(1.6)";
    sb.style.webkitBackdropFilter = "blur(24px) saturate(1.6)";
  } else {
    sb.style.background = "";
    sb.style.backdropFilter = "";
    sb.style.webkitBackdropFilter = "";
  }
  applyBubbleClasses();
};

applyTheme();
/* ===== 补丁 v2.3：三档侧边栏 + 圆滑字体 ===== */

/* 主题页加第三个按钮 */
(function () {
  const seg = document.getElementById("seg-theme");
  if (seg &&!seg.querySelector('[data-v="clear"]')) {
    const b = document.createElement("button");
    b.dataset.v = "clear";
    b.textContent = "高透液态";
    b.onclick = () => {
      state.settings.theme = "clear";
      saveState();
      applyTheme();
      fillThemePanel();
    };
    seg.appendChild(b);
  }
})();

/* 三档侧边栏 */
const _at3 = applyTheme;
applyTheme = function () {
  _at3();
  const sb = document.getElementById("sidebar");
  const mask = document.getElementById("sidebar-mask");
  const a = (state.settings.sidebarAlpha || 72) / 100;
  const t = state.settings.theme;
  if (t === "glass") {
    sb.style.background = "rgba(255,255,255," + a + ")";
    sb.style.backdropFilter = "blur(24px) saturate(1.6)";
    sb.style.webkitBackdropFilter = "blur(24px) saturate(1.6)";
    mask.style.background = "rgba(0,0,0,0.18)";
  } else if (t === "clear") {
    sb.style.background = "rgba(255,255,255," + (a * 0.35) + ")";
    sb.style.backdropFilter = "blur(5px) saturate(1.3)";
    sb.style.webkitBackdropFilter = "blur(5px) saturate(1.3)";
    mask.style.background = "rgba(0,0,0,0.06)";
  } else {
    sb.style.background = "";
    sb.style.backdropFilter = "";
    sb.style.webkitBackdropFilter = "";
    mask.style.background = "";
  }
};

/* 名字粗圆体在上，时间戳细圆体在下，token细圆体 */
function styleMeta() {
  const R = 'ui-rounded,"SF Pro Rounded","PingFang SC",sans-serif';
  document.querySelectorAll(".msg-meta").forEach(meta => {
    meta.style.flexDirection = "column";
    meta.style.gap = "1px";
    const row = meta.closest(".msg-row");
    meta.style.alignItems = row && row.classList.contains("user")? "flex-end" : "flex-start";
    const name = meta.querySelector(".msg-name");
    if (name) {
      name.style.fontFamily = R;
      name.style.fontWeight = "600";
      name.style.fontSize = "11px";
      name.style.color = "#666";
    }
    meta.querySelectorAll("span:not(.msg-name)").forEach(s => {
      s.style.fontFamily = R;
      s.style.fontWeight = "300";
      s.style.fontSize = "9px";
      s.style.color = "#c8c8c8";
    });
  });
  document.querySelectorAll(".msg-footer").forEach(f => {
    f.style.fontFamily = R;
    f.style.fontWeight = "300";
  });
}

const _rm3 = renderMessages;
renderMessages = async function () {
  await _rm3();
  styleMeta();
};

applyTheme();
styleMeta();
/* ===== 补丁 v2.4：输入区融合 + 水感气泡 + 昵称字重 ===== */
if (state.settings.nameWeight === undefined) state.settings.nameWeight = 500;
if (state.settings.bubbleWater === undefined) state.settings.bubbleWater = false;

/* 底部输入区和背景融合 */
(function () {
  const ia = document.getElementById("input-area");
  ia.style.background = "transparent";
  ia.style.backdropFilter = "none";
  ia.style.webkitBackdropFilter = "none";
  ia.style.paddingTop = "2px";
  ia.style.paddingBottom = "calc(2px + env(safe-area-inset-bottom))";
  const ib = document.getElementById("input-box");
  ib.style.background = "rgba(255,255,255,0.45)";
  ib.style.backdropFilter = "blur(14px) saturate(1.5)";
  ib.style.webkitBackdropFilter = "blur(14px) saturate(1.5)";
  ib.style.border = "0.5px solid rgba(255,255,255,0.4)";
  ib.style.boxShadow = "0 1px 10px rgba(0,0,0,0.04)";
})();

/* 水感液态气泡 */
function applyWaterBubbles() {
  const on = state.settings.bubbleWater;
  document.querySelectorAll(".msg-bubble").forEach(b => {
    if (b.classList.contains("ai-bare")) {
      b.style.background = "";
      b.style.backdropFilter = "";
      b.style.webkitBackdropFilter = "";
      b.style.boxShadow = "";
      return;
    }
    if (on) {
      const isUser = b.closest(".msg-row").classList.contains("user");
      b.style.background = isUser? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.13)";
      b.style.backdropFilter = "blur(4px) saturate(1.5)";
      b.style.webkitBackdropFilter = "blur(4px) saturate(1.5)";
      b.style.boxShadow = "inset 0 0 0 0.5px rgba(255,255,255,0.4), 0 2px 8px rgba(0,0,0,0.03)";
    } else {
      b.style.background = "";
      b.style.backdropFilter = "";
      b.style.webkitBackdropFilter = "";
      b.style.boxShadow = "";
    }
  });
}

/* 昵称字重可调，覆盖旧版 */
function styleMeta() {
  const R = 'ui-rounded,"SF Pro Rounded","PingFang SC",sans-serif';
  document.querySelectorAll(".msg-meta").forEach(meta => {
    meta.style.flexDirection = "column";
    meta.style.gap = "1px";
    const row = meta.closest(".msg-row");
    meta.style.alignItems = row && row.classList.contains("user")? "flex-end" : "flex-start";
    const name = meta.querySelector(".msg-name");
    if (name) {
      name.style.fontFamily = R;
      name.style.fontWeight = String(state.settings.nameWeight);
      name.style.fontSize = "11px";
      name.style.color = "#8a8a8a";
    }
    meta.querySelectorAll("span:not(.msg-name)").forEach(s => {
      s.style.fontFamily = R;
      s.style.fontWeight = "300";
      s.style.fontSize = "9px";
      s.style.color = "#c8c8c8";
    });
  });
  document.querySelectorAll(".msg-footer").forEach(f => {
    f.style.fontFamily = R;
    f.style.fontWeight = "300";
  });
}

/* 主题页注入新选项 */
(function () {
  if (document.getElementById("seg-water")) return;
  const panel = document.getElementById("theme-panel");
  const sec = document.createElement("div");
  sec.className = "settings-section";
  sec.innerHTML = `
    <h3>气泡质感</h3>
    <div class="seg-group" id="seg-water">
      <button data-v="off">默认</button>
      <button data-v="on">水感液态</button>
    </div>
    <h3 style="margin-top:16px">昵称粗细</h3>
    <div class="slider-row">
      <div class="slider-head"><span>字重</span><span class="slider-val" id="sl-nw-val"></span></div>
      <input type="range" id="sl-nw" min="200" max="700" step="100">
    </div>`;
  panel.appendChild(sec);

  const refresh = () => {
    document.querySelectorAll("#seg-water button").forEach(b => {
      b.classList.toggle("on", (b.dataset.v === "on") === state.settings.bubbleWater);
    });
  };
  document.querySelectorAll("#seg-water button").forEach(b => {
    b.onclick = () => {
      state.settings.bubbleWater = b.dataset.v === "on";
      saveState();
      applyWaterBubbles();
      refresh();
    };
  });

  const sl = document.getElementById("sl-nw");
  sl.value = state.settings.nameWeight;
  document.getElementById("sl-nw-val").textContent = state.settings.nameWeight;
  sl.addEventListener("input", () => {
    state.settings.nameWeight = parseInt(sl.value);
    document.getElementById("sl-nw-val").textContent = sl.value;
    saveState();
    styleMeta();
  });
  refresh();
})();

/* 每次渲染后自动补妆 */
const _rm4 = renderMessages;
renderMessages = async function () {
  await _rm4();
  styleMeta();
  applyWaterBubbles();
};

styleMeta();
applyWaterBubbles();

