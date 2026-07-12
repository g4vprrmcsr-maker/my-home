/* ============================================
   小家聊天室 app.js
   ============================================ */

/* ---------- 全局状态 ---------- */
const LS_KEY = "home_data_v1";

let DB = null;          // IndexedDB 实例
let state = null;       // 全部数据
let streaming = false;  // 是否正在生成
let abortCtrl = null;   // 中断控制器

/* ---------- 默认数据 ---------- */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaultState() {
  const roleId = uid();
  const sessionId = uid();
  return {
    settings: {
      baseURL: "",
      apiKey: "",
      model: "",
      models: [],
      temperature: 1,
      contextCount: 20,
      theme: "white"   // white 纯白侧边栏 | glass 毛玻璃侧边栏
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
      memories: []   // {id, text, checked}
    }]
  };
}

/* ---------- 数据存取 ---------- */
function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    state = raw? JSON.parse(raw) : defaultState();
  } catch (e) {
    state = defaultState();
  }
}

/* ---------- IndexedDB 图片存储 ---------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("home_images", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("imgs");
    };
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

/* ---------- 默认头像 ---------- */
const AI_FALLBACK = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" rx="36" fill="#D97757"/><text x="36" y="46" font-size="30" text-anchor="middle" fill="#fff" font-family="sans-serif">C</text></svg>'
);
const USER_FALLBACK = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" rx="36" fill="#8aa2c8"/><circle cx="36" cy="28" r="12" fill="#fff"/><ellipse cx="36" cy="58" rx="20" ry="14" fill="#fff"/></svg>'
);

const urlCache = {};

async function avatarSrc(kind) {
  // kind: "ai" | "user"，头像按角色隔离存储
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

/* ---------- 背景图与主题 ---------- */
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
  document.body.classList.toggle("theme-glass", state.settings.theme === "glass");
}
/* ---------- 通用操作菜单 ---------- */
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
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = Math.max(8, left) + "px";
  menu.style.top = Math.max(8, top) + "px";
  setTimeout(() => {
    document.addEventListener("click", closeActions, { once: true });
  }, 0);
}

function closeActions() {
  document.querySelectorAll(".msg-actions").forEach(m => m.remove());
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
  mask.querySelector("#dlg-ok").onclick = () => {
    onOk();
    mask.remove();
  };
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
    div.innerHTML = `<span class="session-name">${esc(s.name)}</span><span class="session-more">⋯</span>`;
    div.querySelector(".session-name").onclick = () => {
      r.currentSessionId = s.id;
      saveState();
      renderAll();
      closeSidebar();
    };
    div.querySelector(".session-more").onclick = (e) => {
      e.stopPropagation();
      showActions([
        { label: "重命名", fn: () => inputDialog("重命名会话", s.name, v => {
            if (v.trim()) { s.name = v.trim(); saveState(); renderSidebar(); }
          }) },
        { label: "删除", danger: true, fn: () => confirmDialog("删除这个会话？", () => {
            r.sessions = r.sessions.filter(x => x.id!== s.id);
            if (!r.sessions.length) r.sessions.push({ id: uid(), name: "新对话", messages: [] });
            if (r.currentSessionId === s.id) r.currentSessionId = r.sessions[0].id;
            saveState();
            renderAll();
          }) }
      ], e.clientX, e.clientY);
    };
    list.appendChild(div);
  });
  $("#topbar-title").textContent = curSession().name;
  $("#current-role-name").textContent = r.name;
  avatarSrc("ai").then(src => { $("#current-role-avatar").src = src; });
}

/* ---------- 新会话 ---------- */
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
    bubble.textContent = msgText(m);

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

    /* 长按 / 右键弹出操作菜单 */
    let pressTimer = null;
    bubble.addEventListener("touchstart", (e) => {
      pressTimer = setTimeout(() => {
        const t = e.touches[0];
        msgMenu(m, t.clientX, t.clientY);
      }, 500);
    }, { passive: true });
    bubble.addEventListener("touchmove", () => clearTimeout(pressTimer), { passive: true });
    bubble.addEventListener("touchend", () => clearTimeout(pressTimer));
    bubble.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      msgMenu(m, e.clientX, e.clientY);
    });
  });

  area.scrollTop = area.scrollHeight;
}

/* ---------- 消息操作菜单 ---------- */
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
      } },
    { label: "删除", danger: true, fn: () => confirmDialog("删除这条消息？", () => {
        s.messages = s.messages.filter(x => x.id!== m.id);
        saveState();
        renderMessages();
      }) }
  ];
  if (m.role === "ai") {
    items.splice(2, 0, { label: "重新生成", fn: () => regenerate(m) });
  }
  showActions(items, x, y);
}
/* ---------- 构建请求上下文 ---------- */
function buildMessages(uptoId) {
  const r = curRole();
  const s = curSession();
  const msgs = [];
  const NL = String.fromCharCode(10);

  let sys = r.systemPrompt || "";
  const mems = r.memories.filter(m => m.checked).map(m => m.text);
  if (mems.length) {
    sys += NL + NL + "[记忆]" + NL + mems.map((t, i) => (i + 1) + ". " + t).join(NL);
  }
  if (sys.trim()) msgs.push({ role: "system", content: sys });

  let history = s.messages;
  if (uptoId) {
    const idx = history.findIndex(m => m.id === uptoId);
    if (idx >= 0) history = history.slice(0, idx);
  }
  const count = state.settings.contextCount || 20;
  history = history.slice(-count);
  history.forEach(m => {
    msgs.push({
      role: m.role === "user"? "user" : "assistant",
      content: msgText(m)
    });
  });
  return msgs;
}


/* ---------- 流式请求 ---------- */
async function streamChat(messages, onDelta) {
  const { baseURL, apiKey, model, temperature } = state.settings;
  if (!baseURL ||!apiKey) throw new Error("请先在设置里填写API地址和Key");
  if (!model) throw new Error("请先选择模型");

  const url = baseURL.replace(/\/+$/, "") + "/chat/completions";
  abortCtrl = new AbortController();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: Number(temperature),
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
    const lines = buf.split("
");
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
      } catch (e) { /* 忽略解析失败的行 */ }
    }
  }
  return usage;
}
/* ---------- 发送消息 ---------- */
async function sendMessage() {
  if (streaming) return;
  const input = $("#input-text");
  const text = input.value.trim();
  if (!text) return;

  const s = curSession();
  s.messages.push({
    id: uid(), role: "user",
    versions: [text], vi: 0,
    time: Date.now()
  });

  /* 第一条消息自动当会话名 */
  if (s.name === "新对话") {
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

/* ---------- 重新生成 ---------- */
async function regenerate(m) {
  if (streaming) return;
  m.versions.push("");
  m.vi = m.versions.length - 1;
  await runStream(m, buildMessages(m.id));
}

/* ---------- 执行流式并渲染 ---------- */
async function runStream(aiMsg, messages) {
  streaming = true;
  $("#send-btn").disabled = true;
  saveState();
  await renderMessages();

  /* 找到气泡实时写入 */
  const row = document.querySelector(`.msg-row[data-id="${aiMsg.id}"]`);
  const bubble = row? row.querySelector(".msg-bubble") : null;
  if (bubble) bubble.classList.add("typing-cursor");
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
      toast(e.message, 5000);
      /* 失败且是全新消息则移除空消息 */
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
    if (bubble) bubble.classList.remove("typing-cursor");
    saveState();
    await renderMessages();
  }
}
/* ---------- 设置面板 ---------- */
function openSettings() {
  fillSettingsForm();
  $("#settings-panel").classList.add("open");
}

function closeSettings() {
  $("#settings-panel").classList.remove("open");
}

function fillSettingsForm() {
  const st = state.settings;
  const r = curRole();
  $("#set-baseurl").value = st.baseURL;
  $("#set-apikey").value = st.apiKey;
  $("#set-temperature").value = st.temperature;
  $("#set-context").value = st.contextCount;
  $("#set-theme").value = st.theme;
  $("#set-ainame").value = r.aiName;
  $("#set-username").value = r.userName;
  $("#set-sysprompt").value = r.systemPrompt;
  renderModelSelect();
  renderRoleList();
  renderMemories();
  avatarSrc("ai").then(src => { $("#preview-ai-avatar").src = src; });
  avatarSrc("user").then(src => { $("#preview-user-avatar").src = src; });
}

function saveSettingsForm() {
  const st = state.settings;
  const r = curRole();
  st.baseURL = $("#set-baseurl").value.trim();
  st.apiKey = $("#set-apikey").value.trim();
  st.temperature = parseFloat($("#set-temperature").value) || 1;
  st.contextCount = parseInt($("#set-context").value) || 20;
  st.theme = $("#set-theme").value;
  r.aiName = $("#set-ainame").value.trim() || "Claude";
  r.userName = $("#set-username").value.trim() || "我";
  r.systemPrompt = $("#set-sysprompt").value;
  saveState();
  applyTheme();
  toast("已保存");
  renderAll();
}

/* ---------- 拉取模型列表 ---------- */
async function fetchModels() {
  const baseURL = $("#set-baseurl").value.trim();
  const apiKey = $("#set-apikey").value.trim();
  if (!baseURL ||!apiKey) { toast("先填API地址和Key"); return; }
  toast("拉取中...");
  try {
    const url = baseURL.replace(/\/+$/, "") + "/models";
    const res = await fetch(url, {
      headers: { "Authorization": "Bearer " + apiKey }
    });
    if (!res.ok) throw new Error("拉取失败 " + res.status);
    const j = await res.json();
    const ids = (j.data || []).map(m => m.id).sort();
    if (!ids.length) throw new Error("没有拉到模型");
    state.settings.models = ids;
    state.settings.baseURL = baseURL;
    state.settings.apiKey = apiKey;
    if (!state.settings.model ||!ids.includes(state.settings.model)) {
      state.settings.model = ids[0];
    }
    saveState();
    renderModelSelect();
    renderModelBtn();
    toast("拉到 " + ids.length + " 个模型");
  } catch (e) {
    toast(e.message, 5000);
  }
}

function renderModelSelect() {
  const sel = $("#set-model");
  sel.innerHTML = "";
  (state.settings.models || []).forEach(id => {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = id;
    if (id === state.settings.model) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => {
    state.settings.model = sel.value;
    saveState();
    renderModelBtn();
  };
}

function renderModelBtn() {
  $("#model-btn").textContent = state.settings.model || "选择模型";
}

/* ---------- 输入框旁模型弹窗 ---------- */
function toggleModelPopup() {
  const pop = $("#model-popup");
  if (pop.classList.contains("show")) {
    pop.classList.remove("show");
    return;
  }
  const models = state.settings.models || [];
  if (!models.length) { toast("先去设置里拉取模型列表"); return; }
  pop.innerHTML = "";
  models.forEach(id => {
    const div = document.createElement("div");
    div.className = "model-item" + (id === state.settings.model? " selected" : "");
    div.textContent = id;
    div.onclick = () => {
      state.settings.model = id;
      saveState();
      renderModelBtn();
      pop.classList.remove("show");
    };
    pop.appendChild(div);
  });
  pop.classList.add("show");
}
/* ---------- 角色管理 ---------- */
function renderRoleList() {
  const list = $("#role-list");
  list.innerHTML = "";
  state.roles.forEach(r => {
    const div = document.createElement("div");
    div.className = "role-list-item" + (r.id === state.currentRoleId? " active" : "");
    div.innerHTML = `
      <img data-rid="${r.id}">
      <div class="role-info">
        <div class="name">${esc(r.name)}</div>
        <div class="desc">${r.sessions.length}个会话 · ${r.memories.length}条记忆</div>
      </div>
      <span class="session-more">⋯</span>`;
    getImg(r.id + "_ai").then(blob => {
      div.querySelector("img").src = blob? URL.createObjectURL(blob) : AI_FALLBACK;
    });
    div.querySelector(".role-info").onclick = () => {
      state.currentRoleId = r.id;
      saveState();
      clearUrlCache();
      fillSettingsForm();
      renderAll();
      applyBg();
      toast("已切换到 " + r.name);
    };
    div.querySelector(".session-more").onclick = (e) => {
      e.stopPropagation();
      showActions([
        { label: "重命名", fn: () => inputDialog("角色名", r.name, v => {
            if (v.trim()) { r.name = v.trim(); saveState(); renderRoleList(); renderSidebar(); }
          }) },
        { label: "删除", danger: true, fn: () => {
            if (state.roles.length <= 1) { toast("至少保留一个角色"); return; }
            confirmDialog("删除角色「" + r.name + "」？会话和记忆都会没", () => {
              ["_ai", "_user", "_bg"].forEach(suffix => delImg(r.id + suffix));
              state.roles = state.roles.filter(x => x.id!== r.id);
              if (state.currentRoleId === r.id) state.currentRoleId = state.roles[0].id;
              saveState();
              clearUrlCache();
              fillSettingsForm();
              renderAll();
              applyBg();
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
    fillSettingsForm();
    renderAll();
    applyBg();
  });
}

/* ---------- 记忆系统 ---------- */
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
/* ---------- 图片上传 ---------- */
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

/* ---------- 导出 / 导入 ---------- */
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "home_backup_" + Date.now() + ".json";
  a.click();
  toast("已导出（注意：图片不含在内）");
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
      fillSettingsForm();
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
  $("#export-txt-bar").style.display = exportMode? "flex" : "none";
  if (!exportMode) {
    document.querySelectorAll(".msg-check").forEach(c => c.checked = false);
  }
}

function doExportTxt() {
  const s = curSession();
  const r = curRole();
  const ids = [...document.querySelectorAll(".msg-check:checked")].map(c => c.dataset.id);
  const msgs = ids.length? s.messages.filter(m => ids.includes(m.id))
    : s.messages;
  if (!msgs.length) { toast("没有可导出的消息"); return; }
  const lines = msgs.map(m => {
    const name = m.role === "user"? r.userName : r.aiName;
    return `[${fmtTime(m.time)}] ${name}：
${msgText(m)}
`;
  });
  const blob = new Blob([lines.join("
")], { type: "text/plain" });
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
  $("#settings-btn").onclick = openSettings;
  $("#settings-back").onclick = closeSettings;
  $("#sidebar-role").onclick = openSettings;

  $("#send-btn").onclick = sendMessage;
  $("#model-btn").onclick = toggleModelPopup;

  /* 输入框自适应高度 */
  const input = $("#input-text");
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  /* 设置面板 */
  $("#save-settings-btn").onclick = saveSettingsForm;
  $("#fetch-models-btn").onclick = fetchModels;
  $("#new-role-btn").onclick = newRole;
  $("#new-memory-btn").onclick = newMemory;

  /* 图片上传 */
  bindImgUpload("#upload-ai-avatar", "_ai", () => {
    fillSettingsForm();
    renderAll();
  });
  bindImgUpload("#upload-user-avatar", "_user", () => {
    fillSettingsForm();
    renderAll();
  });
  bindImgUpload("#upload-bg", "_bg", applyBg);

  /* 数据 */
  $("#export-json-btn").onclick = exportData;
  $("#import-json-input").addEventListener("change", importData);
  $("#export-txt-btn").onclick = toggleExportMode;
  $("#export-txt-confirm").onclick = doExportTxt;
  $("#export-txt-cancel").onclick = toggleExportMode;

  /* 点空白关闭模型弹窗 */
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
