// public/js/chat.js
(function () {
  // ===== DOM =====
  const convList = document.getElementById("convList");
  const messagesEl = document.getElementById("messages");
  const messageInput = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendBtn");
  const attachBtn = document.getElementById("attachBtn");
  const imageInput = document.getElementById("imageInput");
  const typingIndicator = document.getElementById("typingIndicator");
  const peerNameEl = document.getElementById("peerName");
  const peerAvatarEl = document.getElementById("peerAvatar");
  const peerStatusEl = document.getElementById("peerStatus");
  const newGroupBtnEl = document.getElementById("newGroupBtn"); // nút ở sidebar
  const tabs = document.querySelectorAll(".tabs .tab");
  const searchInputEl = document.getElementById("searchInput");

  let CONV_CACHE = [];         // cache toàn bộ conversations
  let CURRENT_FILTER = "all";  // all | direct | groups

  // ===== NHÓM: phần tử modal (nếu có trong EJS) =====
  const modal = document.getElementById("groupModal");
  const userListEl = document.getElementById("userList");
  const groupNameInput = document.getElementById("groupNameInput");
  const cancelGroupBtn = document.getElementById("cancelGroupBtn");
  const confirmGroupBtn = document.getElementById("confirmGroupBtn");

  // ===== STATE =====
  let currentConv = null;
  let currentConvIsGroup = false;
  let currentPeer = null; // { _id, name, online } hoặc null (chỉ áp dụng direct)
  let socket = null;
  let ME_ID = sessionStorage.getItem("ME_ID") || null;
  let pollTimer = null;
  let lastMsgAt = 0;

  // typing local state
  let typingSent = false;
  let typingIdleTimer = null;
  let typingHideTimer = null;

  // chờ ME_ID sẵn sàng
  let meReadyResolve;
  const meReady = new Promise((res) => (meReadyResolve = res));
  const FRIEND_IDS = new Set();
  // cache user để lấy initial nhanh
  const USER_CACHE = new Map();

  // ===== SHIMS: toast & API (nếu chưa có) =====
  function toast(msg) {
    let t = document.querySelector(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 1500);
  }

  if (!window.API) {
    window.API = {
      _token: localStorage.getItem("TOKEN") || null,
      setToken(t) {
        this._token = t;
        if (t) localStorage.setItem("TOKEN", t);
        else localStorage.removeItem("TOKEN");
      },
      async _req(method, url, body, asUpload = false) {
        const headers = {};
        if (!asUpload) headers["Content-Type"] = "application/json";
        if (this._token) headers["Authorization"] = "Bearer " + this._token;
        const res = await fetch(url, {
          method,
          headers,
          credentials: "include",
          body: asUpload ? body : body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
          let err = "HTTP " + res.status;
          try {
            const j = await res.json();
            err = j.message || err;
          } catch {}
          throw new Error(err);
        }
        try {
          return await res.json();
        } catch {
          return {};
        }
      },
      get(url) {
        return this._req("GET", url);
      },
      post(url, body) {
        return this._req("POST", url, body);
      },
      patch(url, body) {
        return this._req("PATCH", url, body);
      },
      delete(url) {
        return this._req("DELETE", url);
      },
      upload(url, fd) {
        return this._req("POST", url, fd, true);
      },
    };
  }

  // ===== HELPERS =====
  const fmtTime = (ts) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const scrollToBottom = () =>
    requestAnimationFrame(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    });

  const ONLY_EMOJI_RE = /^(?:\p{Extended_Pictographic}|\uFE0F|\u200D)+$/u;
  const isOnlyEmoji = (s) => !!s && ONLY_EMOJI_RE.test(String(s).trim());

  const getSenderId = (m) =>
    m.senderId ||
    m.sender ||
    m.from ||
    m.userId ||
    (m.sender && m.sender._id) ||
    (m.user && m.user._id) ||
    null;

  const classForSender = (sender) =>
    !ME_ID ? "other" : String(sender) === String(ME_ID) ? "me" : "other";

  const getInitial = (userOrName) => {
    const n =
      typeof userOrName === "string"
        ? userOrName
        : userOrName?.displayName ||
          userOrName?.username ||
          userOrName?.name ||
          userOrName?.fullName ||
          "";
    return n.trim() ? n.trim().charAt(0).toUpperCase() : "🙂";
  };
  function isGroupConv(c) {
    return c?.type === "group" ||
           (Array.isArray(c?.members) && c.members.length > 2);
  }
  function getDisplayNameFromUser(u) {
    return (
      u?.displayName || u?.username || u?.name || u?.fullName || "Không tên"
    );
  }
  function getDisplayNameFromMessage(m, fallbackId) {
    if (m?.sender && typeof m.sender === "object")
      return getDisplayNameFromUser(m.sender);
    const fromCache = USER_CACHE.get(String(fallbackId));
    if (fromCache) return getDisplayNameFromUser(fromCache);
    return null; // sẽ fetch sau nếu cần
  }

  function repaintMessages() {
    if (!messagesEl) return;
    messagesEl.querySelectorAll(".msg").forEach((node) => {
      const sender = node.dataset.sender || "";
      node.className = "msg " + classForSender(sender);
    });
  }

  function renderMessage(m) {
    if (!messagesEl) return;
    const sender = (getSenderId(m) || "") + "";
    const created = m.createdAt || m.created_at || Date.now();
    const mine = String(sender) === String(ME_ID);

    const msgId = m._id || m.id || null;

    let type = m.type;
    if (!type && typeof m.text === "string" && isOnlyEmoji(m.text)) type = "emoji";

    const row = document.createElement("div");
    row.className = "msg " + (mine ? "me" : "other");
    row.dataset.sender = sender;
    if (msgId) row.dataset.id = msgId;

    // === Avatar trái cho đối phương ===
    if (!mine) {
      let initial = "🙂";
      const ava = document.createElement("div");
      ava.className = "avatar small";
      if (m.sender && typeof m.sender === "object") {
        initial = getInitial(m.sender);
        const sid = String(m.sender._id || m.sender.id || sender);
        if (sid) USER_CACHE.set(sid, m.sender);
      } else {
        const cached = USER_CACHE.get(String(sender));
        if (cached) {
          initial = getInitial(cached);
        } else if (sender) {
          (async () => {
            try {
              const u = await fetchUserById(sender);
              if (u) {
                USER_CACHE.set(String(sender), u);
                ava.textContent = getInitial(u);
              }
            } catch {}
          })();
        }
      }
      ava.textContent = initial;
      row.appendChild(ava);
    }

    // === Cột phải: tên (nếu group & other) + bubble ===
    const stack = document.createElement("div");
    stack.className = "stack";

    if (currentConvIsGroup && !mine) {
      let displayName = getDisplayNameFromMessage(m, sender);
      if (!displayName && sender) {
        (async () => {
          try {
            const u = await fetchUserById(sender);
            if (u) {
              USER_CACHE.set(String(sender), u);
              const nameNode = stack.querySelector(".sender-name");
              if (nameNode) nameNode.textContent = getDisplayNameFromUser(u);
            }
          } catch {}
        })();
      }
      const nameEl = document.createElement("div");
      nameEl.className = "sender-name";
      nameEl.textContent = displayName || "Đang tải...";
      stack.appendChild(nameEl);
    }

    // === Bubble ===
    const bubble = document.createElement("div");
    bubble.className = "bubble" + (type === "emoji" ? " emoji" : "") + (type === "image" ? " image" : "");

    if (type === "image" || m.type === "image") {
      const src = m.image || m.url || m.imageUrl || m.contentUrl || "";
      bubble.innerHTML = `
        <img class="image" src="${src}" alt="image">
        <div class="meta">${fmtTime(created)}</div>`;
    } else if (type === "emoji") {
      const emoji = m.emoji || m.text || "";
      bubble.innerHTML = `
        <div class="emoji-big">${emoji}</div>
        <div class="meta">${fmtTime(created)}</div>`;
    } else {
      const text = (m.recalled ? "Tin nhắn đã được thu hồi" : (m.text || ""));
      bubble.innerHTML = `
        <div class="text">${text}</div>
        <div class="meta">${fmtTime(created)}</div>`;
    }

    // === Ba chấm + menu ===
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    actions.innerHTML = `
      <button class="kebab" ${msgId ? "" : "disabled"} title="Hành động">⋯</button>
      <div class="menu hidden">
        <button class="act-delete-me">Gỡ ở bạn</button>
        ${mine ? `<button class="act-recall">Thu hồi mọi người</button>` : ""}
      </div>`;

    stack.appendChild(bubble);

    // .me: actions trước bubble ; .other: actions sau bubble
    if (mine) {
      row.appendChild(actions);  // trước
      row.appendChild(stack);
    } else {
      row.appendChild(stack);
      row.appendChild(actions);  // sau
    }

    messagesEl.appendChild(row);

    const t = +new Date(created);
    if (!Number.isNaN(t)) lastMsgAt = Math.max(lastMsgAt, t);
    scrollToBottom();
  }

  function renderDateBadge(label) {
    if (!messagesEl) return;
    const b = document.createElement("div");
    b.className = "date-badge";
    b.textContent = label;
    messagesEl.appendChild(b);
    scrollToBottom();
  }

  // ===== FETCH USER BY ID (thử nhiều endpoint phổ biến) =====
  async function fetchUserById(id) {
    if (!id) return null;
    const candidates = [
      `/api/user/${id}`,
     
    ];
    for (const url of candidates) {
      try {
        const r = await API.get(url);
        const user =
          r?.user || r?.data?.user || r?.profile || r?.account || r?.data || r;
        const obj = Array.isArray(user) ? user[0] : user;
        if (!obj) continue;
        obj._id = obj._id || obj.id || obj.userId || obj.uid || id;
        return obj;
      } catch {}
    }
    return null;
  }

  // ===== CONVERSATION DISPLAY HELPERS =====
  const pickName = (user) =>
    user?.displayName ||
    user?.username ||
    user?.name ||
    user?.fullName ||
    "Không tên";

  const pickAvatar = (userOrName) => getInitial(userOrName);

  const normalizeId = (u) =>
    typeof u === "object" ? u._id || u.id || u.userId || u.uid : u;

  function getPeer(conv, meId) {
    const members = conv?.members || conv?.participants || [];
    return members.find((m) => String(normalizeId(m)) !== String(meId));
  }

  function getConversationTitle(conv, meId) {
    const type =
      conv?.type ||
      (Array.isArray(conv?.members) && conv.members.length > 2
        ? "group"
        : "direct");
    if (type === "group")
      return conv?.name || conv?.title || conv?.groupName || "Nhóm";
    const peer = getPeer(conv, meId);
    if (peer && typeof peer === "object") return pickName(peer);
    return conv?.peerName || conv?.name || "Không tên";
  }
// ---------- Sidebar realtime helpers ----------
function previewFromMsg(m) {
  if (!m) return "";
  if (m.type === "image" || m.image || m.url) return "[Ảnh]";
  if (m.type === "emoji" || m.emoji) return String(m.emoji || m.text || "");
  return String(m.text || "");
}

function upsertConversation(convPartial) {
  if (!convPartial) return;
  const id = convPartial._id || convPartial.id;
  if (!id) return;

  const idx = CONV_CACHE.findIndex((c) => String(c._id || c.id) === String(id));
  if (idx >= 0) {
    const existing = CONV_CACHE[idx];
    const merged = { ...existing, ...convPartial };

    // ensure lastMessage / updatedAt preserved if provided
    if (convPartial.lastMessage) merged.lastMessage = convPartial.lastMessage;
    if (convPartial.updatedAt) merged.updatedAt = convPartial.updatedAt;

    // move to front
    CONV_CACHE.splice(idx, 1);
    CONV_CACHE.unshift(merged);
  } else {
    const toInsert = { _id: id, ...convPartial };
    CONV_CACHE.unshift(toInsert);
  }

  // re-render sidebar according to current filter
  renderConvList();

  // preserve active highlight
  [...(convList?.children || [])].forEach((li) => {
    li.classList.toggle("active", li.dataset.id === String(currentConv));
  });
}

/**
 * Gọi khi có message mới (gửi từ ai đó hoặc nhận)
 * m có thể chứa conversationId/conversation/convId/roomId
 */
function onMessageForSidebar(m) {
  if (!m) return;
  const convId = (m.conversationId || m.conversation || m.convId || m.roomId) + "";
  const preview = previewFromMsg(m);
  const updatedAt = m.createdAt || m.created_at || new Date().toISOString();

  upsertConversation({
    _id: convId,
    lastMessage: { text: preview, createdAt: updatedAt },
    updatedAt,
  });
}
// ---------- end helpers ----------

  // ===== DATA =====
  async function loadMe() {
    let me;
    try {
      me = await API.get("/api/user/profile");
    } catch {}
    if (!me) {
      try {
        me = await API.get("/api/auth/me");
      } catch {}
    }

    const user = me?.user || me?.data?.user || me?.profile || me?.account || me;
    const id = user?._id || user?.id || user?.userId || user?.uid || null;
    const name = user?.username || user?.name || user?.displayName || "Bạn";

    ME_ID = id ? String(id) : null;
    if (ME_ID) sessionStorage.setItem("ME_ID", ME_ID);

    const meNameEl = document.getElementById("meName");
    if (meNameEl) meNameEl.textContent = name;

    meReadyResolve && meReadyResolve();
  }
  async function loadFriendsAndCache() {
    FRIEND_IDS.clear();
    try {
      const friends = await API.get("/api/friends/friends");
      if (Array.isArray(friends)) {
        friends.forEach((f) => {
          const id = f._id || f.id;
          if (id) FRIEND_IDS.add(String(id));
        });
      }
    } catch (e) {
      console.warn("Could not load friends list:", e);
    }
  }

 async function loadConversations() {
  if (!convList) return;

  try {
    const data = await API.get("/api/conversations");
    const list = data?.items || data?.conversations || data || [];

    // cache toàn bộ để render theo filter
    CONV_CACHE = Array.isArray(list) ? list.slice() : [];

    // sort by updatedAt desc (fallback to lastMessage.createdAt)
    CONV_CACHE.sort((a, b) => {
      const ta = new Date(a.updatedAt || a.lastMessage?.createdAt || 0).getTime();
      const tb = new Date(b.updatedAt || b.lastMessage?.createdAt || 0).getTime();
      if (tb !== ta) return tb - ta;
      // tie-breaker by id string
      const ida = String(a._id || a.id || "");
      const idb = String(b._id || b.id || "");
      return idb.localeCompare(ida);
    });

    // Render sidebar using existing renderer (keeps filtering logic)
    renderConvList();

    // Warm-up USER_CACHE for peer objects so titles/avatars can be updated quickly
    CONV_CACHE.forEach((c) => {
      const peerRaw = getPeer(c, ME_ID);
      const peerId = normalizeId(peerRaw);
      if (peerRaw && typeof peerRaw === "object" && peerId) {
        USER_CACHE.set(String(peerId), peerRaw);
      }
    });

    // For conversations with missing title (peer is id), fetch user and update the DOM
    CONV_CACHE.forEach(async (c) => {
      const convId = c._id || c.id;
      const peerRaw = getPeer(c, ME_ID);
      const peerId = normalizeId(peerRaw);

      const title = getConversationTitle(c, ME_ID);
      if (title === "Không tên" && peerId) {
        try {
          const u = await fetchUserById(peerId);
          if (!u) return;
          // update cached user and DOM row if present
          USER_CACHE.set(String(peerId), u);
          const row = convList.querySelector(`li[data-id="${convId}"]`);
          if (!row) return;
          const titleEl = row.querySelector(".title");
          const avaEl = row.querySelector(".avatar");
          if (titleEl) titleEl.textContent = pickName(u);
          if (avaEl) avaEl.textContent = pickAvatar(u);
          row.dataset.user = u._id || peerId;
        } catch (err) {
          // ignore per-item failures
          console.warn("fetchUserById for conv", convId, err);
        }
      }
    });
  } catch (err) {
    console.error("loadConversations error:", err);
    // keep existing UI but notify user
    convList.innerHTML = `<div style="padding:10px;color:red">Không tải được danh sách cuộc trò chuyện.</div>`;
  }
}


  function renderConvList() {
    if (!convList) return;
    convList.innerHTML = "";

    const q = (searchInputEl?.value || "").trim().toLowerCase();

    // lọc theo tab + từ khóa
    const filtered = CONV_CACHE.filter((c) => {
      if (CURRENT_FILTER === "groups" && !isGroupConv(c)) return false;
      if (CURRENT_FILTER === "direct" && isGroupConv(c))  return false;

      if (q) {
        const title = (getConversationTitle(c, ME_ID) || "").toLowerCase();
        if (!title.includes(q)) return false;
      }
      return true;
    });

    // render lại danh sách
    filtered.forEach((c) => {
      const convId = c._id || c.id;
      const peerRaw = getPeer(c, ME_ID);
      if (peerRaw && typeof peerRaw === "object") {
        const pid = String(normalizeId(peerRaw));
        if (pid) USER_CACHE.set(pid, peerRaw);
      }
      const peerId = normalizeId(peerRaw);
      const title = getConversationTitle(c, ME_ID);

      const li = document.createElement("li");
      li.dataset.id = convId;
      li.dataset.type = isGroupConv(c) ? "group" : "direct";
      if (peerId) li.dataset.user = peerId;

      const avaChar =
        isGroupConv(c) ? "👥"
        : typeof peerRaw === "object" ? pickAvatar(peerRaw)
        : c.peerName?.[0]?.toUpperCase() || "👤";

      const last = c.lastMessage?.text || c.last?.text || c.preview?.text || "";
      const updated =
        c.updatedAt || c.lastMessage?.createdAt || c.last?.createdAt;

      li.innerHTML = `
        <div class="avatar">${avaChar}</div>
        <div class="col">
          <div class="title">${title}</div>
          <div class="last">${last}</div>
        </div>
        <div class="time">${updated ? fmtTime(updated) : ""}</div>
        <div class="status">⚫</div>
      `;
      li.addEventListener("click", () => openConversation(convId, c));
      convList.appendChild(li);

      // nếu title “Không tên” mà chỉ có peerId -> fetch user để cập nhật
      if (title === "Không tên" && peerId) {
        (async () => {
          const u = await fetchUserById(peerId);
          if (!u) return;
          const row = convList.querySelector(`li[data-id="${convId}"]`);
          if (!row) return;
          row.querySelector(".title").textContent = pickName(u);
          row.querySelector(".avatar").textContent = pickAvatar(u);
          row.dataset.user = u._id || peerId;
        })();
      }
    });
  }

  // ====== BỘ LỌC CUỘC TRÒ CHUYỆN (tabs) ======
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      // Bỏ active cũ
      tabs.forEach(t => t.classList.remove("active"));
      // Đánh dấu tab hiện tại
      tab.classList.add("active");

      // Cập nhật biến filter
      CURRENT_FILTER = tab.dataset.tab || "all";

      // Render lại danh sách theo bộ lọc
      renderConvList();
    });
  });

  // ===== SOCKET =====
  function ensureSocket() {
    if (socket) return;

    const token = localStorage.getItem("TOKEN");
    socket = window.io({
      withCredentials: true,
      auth: token ? { token } : undefined,
    });

    socket.on("connect", () => {
      console.log("socket connected");
      refreshPeerOnline();
    });

    const onIncoming = (m) => {
      const convId =
        (m.conversationId || m.conversation || m.convId || m.roomId) + "";

      // CẬP NHẬT SIDEBAR CHO TẤT CẢ TRƯỜNG HỢP (bên kia gửi hoặc server thông báo)
      try { onMessageForSidebar(m); } catch (e) { console.warn("sidebar update err:", e); }

      if (String(convId) === String(currentConv)) {
        renderMessage({ ...m });
      } else {
        // Nếu không phải convo đang mở: toast + sidebar đã được update
        toast(`Tin nhắn mới từ ${getDisplayNameFromMessage(m, getSenderId(m))}`);
      }
    };
    socket.on("message:new", onIncoming);
    socket.on("message:created", onIncoming);
    socket.on("chat:message", onIncoming);
    socket.on("message", onIncoming);

    // notification:message cũng cập nhật
    socket.on("notification:message", (m) => {
      try { onMessageForSidebar(m); } catch (e) { console.warn(e); }
      // choose whether to toast
      toast(`Tin nhắn mới từ ${getDisplayNameFromMessage(m, getSenderId(m))}`);
    });


    socket.on("typing", ({ conversationId, userId, isTyping }) => {
      if (String(conversationId) !== String(currentConv)) return;
      if (ME_ID && String(userId) === String(ME_ID)) return;
      if (isTyping) {
        typingIndicator?.classList.remove("hidden");
        clearTimeout(typingHideTimer);
        typingHideTimer = setTimeout(
          () => typingIndicator?.classList.add("hidden"),
          3000
        );
      } else {
        typingIndicator?.classList.add("hidden");
      }
    });

    socket.on("conversation:created", () => loadConversations());

    const onConvUpdate = () => {
      console.log("Cập nhật danh sách hội thoại do sự kiện socket");
      loadConversations();
    };

    socket.on("conversation:update", onConvUpdate);
    socket.on("conversation:new", onConvUpdate);

    socket.on("user:status", ({ userId, online }) => {
      if (
        currentPeer &&
        String(currentPeer._id || currentPeer.id) === String(userId)
      ) {
        currentPeer.online = !!online;
        peerStatusEl.textContent = online ? "Đang hoạt động" : "Ngoại tuyến";
      }
      const dot = document.querySelector(
        `.conv-list li[data-user="${userId}"] .status`
      );
      if (dot) dot.textContent = online ? "🟢" : "⚫";
    });

    socket.on("message:recalled", ({ messageId }) => {
      const row = messagesEl?.querySelector(`.msg[data-id="${messageId}"]`);
      if (row) {
        const textEl = row.querySelector(".bubble .text");
        if (textEl) textEl.textContent = "Tin nhắn đã được thu hồi";
        row.querySelector(".menu")?.classList.add("hidden");
      } else {
        loadConversations();
      }
    });
  }

  // ===== POLLING (fallback) =====
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      if (!currentConv) return;
      try {
        const q = new URLSearchParams({
          conversationId: currentConv,
          limit: 20,
        }).toString();
        let list = await API.get("/api/messages?" + q);
        if (!Array.isArray(list)) list = list?.items || list?.messages || [];
        list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const fresh = list.filter((m) => {
          const t = +new Date(m.createdAt || Date.now());
          return !Number.isNaN(t) && t > lastMsgAt;
        });
        if (fresh.length) fresh.forEach(renderMessage);
      } catch {}
    }, 5000);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  // ===== TYPING (client emits) =====
  function emitTypingStart() {
    if (!socket || !currentConv || typingSent || !ME_ID) return;
    socket.emit("typing:start", { conversationId: currentConv, userId: ME_ID });
    typingSent = true;
  }
  function scheduleTypingStop() {
    clearTimeout(typingIdleTimer);
    typingIdleTimer = setTimeout(() => {
      if (socket && currentConv && ME_ID)
        socket.emit("typing:stop", {
          conversationId: currentConv,
          userId: ME_ID,
        });
      typingSent = false;
    }, 1500);
  }
  function forceTypingStop() {
    clearTimeout(typingIdleTimer);
    if (socket && currentConv && ME_ID)
      socket.emit("typing:stop", {
        conversationId: currentConv,
        userId: ME_ID,
      });
    typingSent = false;
  }

  // ===== UI ACTIONS =====
  async function openConversation(id, convMeta) {
    await meReady;
    currentConv = id;

    if (convList) {
      [...convList.children].forEach((li) =>
        li.classList.toggle("active", li.dataset.id === String(id))
      );
    }

    // lấy conv chi tiết nếu cần populate
    let conv = convMeta;
    try {
      if (
        !convMeta?.members?.[0] ||
        typeof getPeer(convMeta, ME_ID) !== "object"
      ) {
        const detail = await API.get(`/api/conversations/${id}`);
        if (detail?._id) conv = detail;
      }
    } catch {}

    // xác định peer
    let peer = getPeer(conv || convMeta || {}, ME_ID);
    let peerId = normalizeId(peer);

    if (!peer || typeof peer !== "object") {
      if (peerId) {
        const u = await fetchUserById(peerId);
        if (u) peer = u;
      }
    }

    // header
    const isGroup =
      (conv?.type || convMeta?.type) === "group" ||
      (Array.isArray((conv || convMeta)?.members) &&
        (conv || convMeta).members.length > 2);
    currentConvIsGroup = !!isGroup;
    if (isGroup) {
      peerNameEl.textContent = getConversationTitle(conv || convMeta, ME_ID);
      peerAvatarEl.textContent = "👥";
      peerStatusEl.textContent = "—";
      currentPeer = null;
    } else {
      const displayName = pickName(peer) || "Không tên";
      peerNameEl.textContent = displayName;
      peerAvatarEl.textContent = pickAvatar(peer || displayName);
      peerStatusEl.textContent = peer?.online
        ? "Đang hoạt động"
        : "Ngoại tuyến";
      currentPeer = {
        _id: normalizeId(peer) || peerId,
        name: displayName,
        online: !!peer?.online,
      };
      refreshPeerOnline();
    }

    // reset view + typing indicator
    if (messagesEl) {
      messagesEl.innerHTML = "";
      typingIndicator?.classList.add("hidden");
      lastMsgAt = 0;
      renderDateBadge("Hôm nay");
    }

    // load history
    try {
      const q = new URLSearchParams({
        conversationId: id,
        limit: 100,
      }).toString();
      let hist = await API.get("/api/messages?" + q);
      if (!Array.isArray(hist)) hist = hist?.items || hist?.messages || [];
      hist.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      hist.forEach(renderMessage);
      repaintMessages();
      scrollToBottom();
    } catch (err) {
      console.warn(err);
      toast("Không tải được lịch sử trò chuyện");
    }

    ensureSocket();
    socket.emit("conversation:join", {
      conversationId: id,
      conversation: id,
      roomId: id,
      convId: id,
    });
    startPolling();
  }

  async function send() {
    if (!currentConv) return;

    // 1) ảnh
    await sendImages();

    // 2) text / emoji
    const raw = (messageInput.value || "").trim();
    if (!raw) return;

    const isEmoji = isOnlyEmoji(raw);
    const baseText = { type: "text", text: raw };
    const baseEmoji = { type: "emoji", emoji: raw };

    const bodies = isEmoji
      ? [
          { conversationId: currentConv, ...baseEmoji },
          { conversation: currentConv, ...baseEmoji },
          { convId: currentConv, ...baseEmoji },
          { roomId: currentConv, ...baseEmoji },
        ]
      : [
          { conversationId: currentConv, ...baseText },
          { conversation: currentConv, ...baseText },
          { convId: currentConv, ...baseText },
          { roomId: currentConv, ...baseText },
        ];

    let lastErr = null;
    for (const body of bodies) {
      try {
        const msg = await API.post("/api/messages", body);
        messageInput.value = "";
        const show =
          msg && (msg._id || msg.text || msg.emoji)
            ? msg
            : {
                _id: "local-" + Date.now(),
                conversation: currentConv,
                sender: ME_ID,
                ...(isEmoji ? baseEmoji : baseText),
                createdAt: new Date().toISOString(),
              };
         renderMessage(show);
        try { onMessageForSidebar(show); } catch (e) { console.warn(e); }
        if (socket)
          socket.emit("message:new", { ...show, conversationId: currentConv });
        forceTypingStop();
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    toast(lastErr?.message || "Không thể gửi");
  }

  // === HỎI LẠI TRẠNG THÁI ONLINE BAN ĐẦU ===
  function refreshPeerOnline() {
    if (!io || !currentPeer) return;
    socket.emit("user:whoOnline", {}, (resp) => {
      const list = resp?.users || [];
      const uid = String(currentPeer._id || currentPeer.id);
      const on = list.some((x) => String(x) === uid);

      peerStatusEl.textContent = on ? "Đang hoạt động" : "Ngoại tuyến";
      const row = document.querySelector(
        `.conv-list li[data-user="${uid}"] .status`
      );
      if (row) row.textContent = on ? "🟢" : "⚫";
    });
  }

  // ===== BINDINGS =====
  sendBtn?.addEventListener("click", send);
  messageInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  messageInput?.addEventListener("input", () => {
    if (!currentConv || !ME_ID) return;
    if (messageInput.value.length) emitTypingStart();
    scheduleTypingStop();
  });
  messageInput?.addEventListener("focus", () => {
    if (messageInput.value.length) emitTypingStart();
  });
  messageInput?.addEventListener("blur", () => {
    forceTypingStop();
  });

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    try {
      await API.post("/api/auth/logout");
    } catch {}
    API.setToken(null);
    location.href = "/login";
  });

  // Toggle menu ba chấm
  messagesEl?.addEventListener("click", (e) => {
    const kebab = e.target.closest(".kebab");
    const row = e.target.closest(".msg");
    if (kebab && row) {
      const menu = row.querySelector(".menu");
      document.querySelectorAll(".msg .menu").forEach(m => m.classList.add("hidden"));
      menu?.classList.toggle("hidden");
    }

    // Gỡ ở bạn
    const delBtn = e.target.closest(".act-delete-me");
    if (delBtn) {
      const row = e.target.closest(".msg");
      const id = row?.dataset.id;
      if (!id) return toast("Tin vừa gửi chưa có ID—thử lại sau.");
      deleteForMe(id, row);
    }

    // Thu hồi mọi người (chỉ hiện với tin của mình)
    const recallBtn = e.target.closest(".act-recall");
    if (recallBtn) {
      const row = e.target.closest(".msg");
      const id = row?.dataset.id;
      if (!id) return toast("Tin vừa gửi chưa có ID—thử lại sau.");
      recallMessage(id, row);
    }
  });

  // Ẩn menu khi click ra ngoài
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".msg-actions")) {
      document.querySelectorAll(".msg .menu").forEach(m => m.classList.add("hidden"));
    }
  });

  // Call APIs
  async function deleteForMe(messageId, rowEl) {
    try {
      await API.post(`/api/messages/${messageId}/deleteForMe`, {});
      rowEl?.remove();                        // xoá khỏi màn hình
      toast("Đã gỡ ở bạn");
    } catch (e) {
      toast(e?.message || "Không thể gỡ ở bạn");
    }
  }

  async function recallMessage(messageId, rowEl) {
    try {
      await API.post(`/api/messages/${messageId}/recall`, {});
      // Cập nhật UI tại chỗ
      const textEl = rowEl?.querySelector(".bubble .text");
      if (textEl) textEl.textContent = "Tin nhắn đã được thu hồi";
      rowEl?.querySelector(".menu")?.classList.add("hidden");
      toast("Đã thu hồi");
      // Đồng bộ lại lịch sử/preview
      await loadConversations();
    } catch (e) {
      toast(e?.message || "Không thể thu hồi");
    }
  }

  // ===== BOOT =====
  (async function boot() {
    try {
      await loadMe();
      ensureSocket();
      await loadFriendsAndCache();
      repaintMessages();
      await loadConversations();
      await loadFriendRequests();
    } catch (err) {
      console.warn(err);
      location.href = "/login";
    }
  })();

  // ===== EMOJI =====
  const emojiBtn = document.getElementById("emojiBtn");
  const emojiPicker = document.getElementById("emojiPicker");

  function toggleEmoji() {
    if (!emojiPicker) return;
    emojiPicker.classList.toggle("hidden");
    if (!emojiPicker.classList.contains("hidden")) emojiPicker.scrollTop = 0;
  }
  emojiBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleEmoji();
  });
  document.addEventListener("click", (e) => {
    if (!emojiPicker || emojiPicker.classList.contains("hidden")) return;
    const within =
      emojiPicker.contains(e.target) || emojiBtn.contains(e.target);
    if (!within) emojiPicker.classList.add("hidden");
  });
  emojiPicker?.addEventListener("emoji-click", (ev) => {
    const emoji = ev.detail.unicode;
    const el = messageInput;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + emoji + el.value.slice(end);
    const pos = start + emoji.length;
    el.setSelectionRange(pos, pos);
    el.focus();
    emitTypingStart();
    scheduleTypingStop();
  });

  // ===== ẢNH: preview + upload =====
  const previewBar = document.getElementById("previewBar");
  let pendingFiles = [];

  function refreshPreview() {
    if (!previewBar) return;
    previewBar.innerHTML = "";
    if (!pendingFiles.length) {
      previewBar.classList.add("hidden");
      return;
    }
    previewBar.classList.remove("hidden");
    pendingFiles.forEach((file, idx) => {
      const url = URL.createObjectURL(file);
      const item = document.createElement("div");
      item.className = "preview-item";
      item.innerHTML = `<img src="${url}" alt=""><button class="rm" title="Xoá" data-i="${idx}">×</button>`;
      previewBar.appendChild(item);
    });
    previewBar.querySelectorAll(".rm").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = +btn.dataset.i;
        pendingFiles.splice(i, 1);
        refreshPreview();
      });
    });
  }

  function enqueueFiles(files) {
    const list = Array.from(files).filter(
      (f) => f && f.type?.startsWith("image/")
    );
    if (!list.length) return;
    pendingFiles.push(...list);
    refreshPreview();
  }

  attachBtn?.addEventListener("click", () => imageInput?.click());
  imageInput?.addEventListener("change", (e) => {
    enqueueFiles(e.target.files || []);
    imageInput.value = "";
  });

  document.addEventListener("paste", (e) => {
    if (!currentConv) return;
    const items = e.clipboardData?.items || [];
    const files = [];
    for (const it of items)
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    enqueueFiles(files);
  });

  messagesEl?.addEventListener("dragover", (e) => e.preventDefault());
  messagesEl?.addEventListener("drop", (e) => {
    e.preventDefault();
    enqueueFiles(e.dataTransfer?.files || []);
  });

  async function sendImages() {
    if (!pendingFiles.length || !currentConv) return [];
    const results = [];
    for (const file of pendingFiles) {
      const fd = new FormData();
      fd.append("conversationId", currentConv);
      fd.append("file", file); // khớp multer.single('file')

      let msg = null,
        urlFromServer = null,
        localPreview = null;
      try {
        msg = await API.upload("/api/messages/upload", fd);
        urlFromServer =
          msg?.image || msg?.url || msg?.imageUrl || msg?.contentUrl || null;
      } catch (e) {
        console.warn("[upload] failed", e);
      }

      if (!urlFromServer) localPreview = URL.createObjectURL(file);

      const show =
        msg && (msg._id || urlFromServer)
          ? msg
          : {
              _id: "local-img-" + Date.now(),
              conversation: currentConv,
              sender: ME_ID,
              type: "image",
              url: urlFromServer || localPreview,
              image: urlFromServer || localPreview,
              createdAt: new Date().toISOString(),
            };

      renderMessage(show);
      results.push(show);
      if (io)
        socket.emit("message:new", { ...show, conversationId: currentConv });
    }
    pendingFiles = [];
    refreshPreview();
    return results;
  }

  // ========== NHÓM: GỌI API & luồng thao tác ==========
async function renameGroupFlow() {
  if (!currentConv) {
    toast("Chọn cuộc trò chuyện trước đã");
    return;
  }

  const name = (prompt("Tên nhóm mới:") || "").trim();
  if (!name) return;

  toast("Đang đổi tên...");

  try {
    // Nếu API.patch tồn tại thì dùng, ngược lại fallback về fetch trực tiếp
    if (window.API && typeof window.API.patch === "function") {
      await API.patch(`/api/conversations/${currentConv}/name`, { name });
    } else {
      // fallback: lấy token nếu có
      const token = localStorage.getItem("TOKEN");
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = "Bearer " + token;

      const resp = await fetch(`/api/conversations/${currentConv}/name`, {
        method: "PATCH",
        headers,
        credentials: "include", // nếu bạn dùng cookie-based auth
        body: JSON.stringify({ name }),
      });

      if (!resp.ok) {
        let txt = await resp.text().catch(() => "");
        let json;
        try { json = txt ? JSON.parse(txt) : null; } catch {}
        const msg = (json && (json.message || json.error)) || txt || `HTTP ${resp.status}`;
        throw new Error(msg);
      }
    }

    // Thành công -> cập nhật UI
    peerNameEl.textContent = name;
    const row = document.querySelector(`.conv-list li[data-id="${currentConv}"] .title`);
    if (row) row.textContent = name;
    toast("Đã đổi tên nhóm");
  } catch (e) {
    console.error("renameGroup error:", e);
    if (String(e?.message || "").includes("401")) {
      toast("Bạn chưa đăng nhập — vui lòng đăng nhập rồi thử lại.");
    } else {
      toast(e?.message || "Đổi tên thất bại");
    }
  }
}


 // ====== Thêm thành viên bằng modal chọn ======
const addMemberModal = document.getElementById("addMemberModal");
const addMemberUserList = document.getElementById("addMemberUserList");
const cancelAddMemberBtn = document.getElementById("cancelAddMemberBtn");
const confirmAddMemberBtn = document.getElementById("confirmAddMemberBtn");

async function addMembersFlow() {
  if (!currentConv) return toast("Chưa chọn nhóm");
  if (!addMemberModal) return toast("Không tìm thấy modal thêm thành viên");

  // Hiện modal
  addMemberModal.classList.remove("hidden");
  addMemberUserList.innerHTML = `<div style='padding:10px'>Đang tải danh sách...</div>`;

 // inside addMembersFlow() — replace the part that fills addMemberUserList.innerHTML
try {
  const res = await API.get("/api/user/list");
  const list = res?.items || res?.users || res || [];

  // Lấy chi tiết convo để biết ai đang là member (có thể là id hoặc object)
  let convDetail = null;
  try {
    convDetail = await API.get(`/api/conversations/${currentConv}`);
  } catch (err) {
    // ignore, vẫn tiếp tục với danh sách toàn bộ user
    convDetail = null;
  }

  // Chuẩn hoá memberIds -> Set chuỗi
  const memberIdsSet = new Set();
  (convDetail?.members || []).forEach((m) => {
    if (!m) return;
    const id = typeof m === "string" ? m : m._id || m.id || m.userId || null;
    if (id) memberIdsSet.add(String(id));
  });

  // Loại bỏ user đã là thành viên và chính mình
  const candidates = (list || []).filter((u) => {
    const uid = String(u._id || u.id || u.userId || "");
    if (!uid) return false;
    if (memberIdsSet.has(uid)) return false; // đã có trong nhóm -> loại
    if (String(uid) === String(ME_ID)) return false; // không hiện chính bạn
    return true;
  });

  if (!candidates.length) {
    addMemberUserList.innerHTML = `<div style='padding:10px'>Không có người dùng nào phù hợp để thêm (mọi người đã là thành viên).</div>`;
    return;
  }

  addMemberUserList.innerHTML = candidates
    .map(u => {
      const uid = u._id || u.id || u.userId || "";
      return `
        <label class="user-item" style="display:flex;align-items:center;gap:8px;padding:6px;">
          <input type="checkbox" value="${uid}">
          <div class="avatar small">${getInitial(u.name || u.username || "U")}</div>
          <div style="flex:1;">
            <div class="name">${u.name || u.username || "Không tên"}</div>
            <div class="detail">${u.email || ""}</div>
          </div>
        </label>
      `;
    })
    .join("");
} catch (e) {
  addMemberUserList.innerHTML = `<div style='padding:10px;color:red'>Lỗi tải danh sách người dùng.</div>`;
}

}

function closeAddMemberModal() {
  if (addMemberModal) addMemberModal.classList.add("hidden");
}

cancelAddMemberBtn?.addEventListener("click", closeAddMemberModal);
addMemberModal?.addEventListener("click", (e) => {
  if (e.target === addMemberModal) closeAddMemberModal();
});

confirmAddMemberBtn?.addEventListener("click", async () => {
  const selected = [...addMemberUserList.querySelectorAll("input:checked")].map(i => i.value);
  if (!selected.length) return toast("Chọn ít nhất 1 người");

  try {
    await API.post(`/api/conversations/${currentConv}/members`, { userIds: selected });
    toast("Đã thêm thành viên!");
    closeAddMemberModal();
  } catch (e) {
    toast(e?.message || "Thêm thành viên thất bại");
  }
});


 // === Remove member modal elements (ensure these IDs match HTML) ===
const removeMemberModal = document.getElementById("removeMemberModal");
const removeMemberUserList = document.getElementById("removeMemberUserList");
const cancelRemoveMemberBtn = document.getElementById("cancelRemoveMemberBtn");
const confirmRemoveMemberBtn = document.getElementById("confirmRemoveMemberBtn");

function closeRemoveMemberModal() {
  if (removeMemberModal) removeMemberModal.classList.add("hidden");
  if (removeMemberUserList) removeMemberUserList.innerHTML = "";
}

// Close handlers
cancelRemoveMemberBtn?.addEventListener("click", closeRemoveMemberModal);
removeMemberModal?.addEventListener("click", (e) => {
  if (e.target === removeMemberModal) closeRemoveMemberModal();
});

// ===== New removeMemberFlow using modal (shows current members to pick) =====
async function removeMemberFlow() {
  // Fallback to old prompt if no modal present
  if (!removeMemberModal || !removeMemberUserList) {
    // Existing prompt fallback
    const uid = (prompt("Nhập userId cần xoá khỏi nhóm:") || "").trim();
    if (!uid) return;
    try {
      await API.delete(`/api/conversations/${currentConv}/members/${uid}`);
      toast("Đã xoá thành viên");
      await loadConversations();
    } catch (e) {
      toast(e?.message || "Xoá thành viên thất bại");
    }
    return;
  }

  if (!currentConv) {
    toast("Chọn cuộc trò chuyện trước đã");
    return;
  }

  // Show modal and load members
  removeMemberModal.classList.remove("hidden");
  removeMemberUserList.innerHTML = `<div style='padding:10px'>Đang tải danh sách thành viên...</div>`;

  try {
    // Lấy chi tiết conv để biết members
    const conv = await API.get(`/api/conversations/${currentConv}`);
    const members = conv?.members || conv?.participants || [];

    if (!members || !members.length) {
      removeMemberUserList.innerHTML = `<div style='padding:10px'>Không có thành viên để hiển thị.</div>`;
      return;
    }

    // Chuẩn hoá danh sách thành viên -> array of { id, name, isOwner }
    const normalized = await Promise.all(
      members.map(async (m) => {
        // m có thể là string id, object { _id, name }, hoặc user-like
        let id = typeof m === "string" ? m : m?._id || m?.id || m?.userId || null;
        let name = "";
        let isOwner = false;
        // Nếu item là object có thông tin
        if (typeof m === "object" && (m.name || m.username || m.displayName)) {
          name = m.name || m.username || m.displayName || String(id);
        } else {
          // cố fetch user nếu cần
          try {
            const u = await fetchUserById(id);
            name = getDisplayNameFromUser(u) || String(id);
          } catch {
            name = String(id);
          }
        }
        // owner detection (if conv.owner exists)
        if (conv?.owner) {
          isOwner = String(conv.owner) === String(id);
        }
        // do not show current user as removable (unless you want to allow)
        const isMe = String(id) === String(ME_ID);
        return { id: String(id), name, isOwner: !!isOwner, isMe: !!isMe };
      })
    );

    // Build candidate list: show members that can be removed:
    // - Exclude owner (can't remove owner) and exclude yourself (ME_ID)
    const candidates = normalized.filter((it) => !it.isOwner && !it.isMe);

    if (!candidates.length) {
      removeMemberUserList.innerHTML = `<div style='padding:10px'>Không có thành viên nào có thể xoá (owner và bạn không hiển thị).</div>`;
      return;
    }

    removeMemberUserList.innerHTML = candidates
      .map(
        (u) => `
      <label class="user-item" style="display:flex;align-items:center;gap:8px;padding:6px;">
        <input type="checkbox" value="${u.id}">
        <div class="avatar small">${getInitial(u.name || u.id)}</div>
        <div style="flex:1;">
          <div class="name">${u.name || u.id}</div>
          <div class="detail">${u.id}</div>
        </div>
      </label>
    `
      )
      .join("");
  } catch (err) {
    console.error("load members for remove error:", err);
    removeMemberUserList.innerHTML = `<div style='padding:10px;color:red'>Lỗi tải danh sách thành viên.</div>`;
  }
}

// Khi bấm Xoá (confirm)
confirmRemoveMemberBtn?.addEventListener("click", async () => {
  const selected = [...(removeMemberUserList?.querySelectorAll("input:checked") || [])].map(
    (i) => i.value
  );
  if (!selected.length) {
    return toast("Chọn ít nhất 1 thành viên để xoá.");
  }

  if (!confirm(`Bạn chắc chắn muốn xoá ${selected.length} thành viên khỏi nhóm?`)) return;

  try {
    // Nếu backend chỉ hỗ trợ xoá từng người, gọi lần lượt
    await Promise.all(
      selected.map((uid) =>
        API.delete(`/api/conversations/${currentConv}/members/${uid}`).catch((e) => {
          // trả lỗi từng người nhưng vẫn tiếp tục
          console.warn(`Failed removing ${uid}:`, e);
          throw e;
        })
      )
    );

    toast("Đã xoá thành viên");
    closeRemoveMemberModal();
    // cập nhật sidebar / conv detail
    await loadConversations();
    // nếu đang mở conversation, reload chi tiết
    if (currentConv) await openConversation(currentConv, null);
  } catch (e) {
    console.error("remove members error:", e);
    toast(e?.message || "Xoá thành viên thất bại");
  }
});


  async function leaveGroupFlow() {
    if (!currentConv) return;
    if (!confirm("Bạn chắc chắn rời nhóm?")) return;
    try {
      await API.post(`/api/conversations/${currentConv}/leave`, {});
      toast("Đã rời nhóm");
      currentConv = null;
      await loadConversations();
      peerNameEl.textContent = "Chọn một cuộc trò chuyện";
      peerAvatarEl.textContent = "🙂";
      peerStatusEl.textContent = "—";
      if (messagesEl) messagesEl.innerHTML = "";
    } catch (e) {
      toast(e?.message || "Rời nhóm thất bại");
    }
  }

  // ====== TẠO NHÓM BẰNG MODAL (UI chọn user) ======
  async function openGroupModal() {
    if (!modal) return; // nếu bạn chưa nhúng modal trong EJS thì bỏ qua
    modal.classList.remove("hidden");
    if (userListEl)
      userListEl.innerHTML = "<div style='padding:10px'>Đang tải...</div>";
    try {
      const res = await API.get("/api/user/list");
      const list = res?.items || res?.users || res || [];
      if (userListEl) {
        userListEl.innerHTML = list
          .filter((u) => String(u._id || u.id) !== String(ME_ID))
          .map(
            (u) => `
            <label class="user-item">
              <input type="checkbox" value="${u._id || u.id}">
              <div class="avatar small">${getInitial(
                u.name || u.username || "U"
              )}</div>
              <div>${u.name || u.username || "Không tên"}</div>
            </label>
          `
          )
          .join("");
      }
    } catch {
      if (userListEl)
        userListEl.innerHTML = `<div style='padding:10px;color:red'>Lỗi tải danh sách</div>`;
    }
  }

  function closeGroupModal() {
    if (!modal) return;
    modal.classList.add("hidden");
    if (groupNameInput) groupNameInput.value = "";
    if (userListEl) userListEl.innerHTML = "";
  }

  async function handleCreateGroup() {
    const name = groupNameInput.value.trim();
    if (!name) return toast("Nhập tên nhóm");
    const selected = [...userListEl.querySelectorAll("input:checked")].map(
      (i) => i.value
    );
    if (!selected.length) return toast("Chọn ít nhất 1 người");

    try {
      const conv = await API.post("/api/conversations/group", {
        name,
        memberIds: selected,
      });
      toast("Tạo nhóm thành công");
      closeGroupModal();
      await loadConversations();
      openConversation(conv._id || conv.id, conv);
    } catch (e) {
      toast(e?.message || "Không thể tạo nhóm");
    }
  }

  // Bind modal nếu tồn tại
  if (newGroupBtnEl && modal) {
    newGroupBtnEl.addEventListener("click", openGroupModal);
    cancelGroupBtn?.addEventListener("click", closeGroupModal);
    confirmGroupBtn?.addEventListener("click", handleCreateGroup);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeGroupModal();
    });
  } else if (newGroupBtnEl && !modal) {
    // fallback: vẫn cho tạo nhóm bằng prompt nếu chưa gắn modal trong EJS
    newGroupBtnEl.addEventListener("click", async () => {
      const name = (prompt("Tên nhóm:") || "").trim();
      if (!name) return;
      const raw = (prompt("Nhập userId (cách nhau dấu phẩy):") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      try {
        const conv = await API.post("/api/conversations/group", {
          name,
          members: raw,
        });
        toast("Đã tạo nhóm");
        await loadConversations();
        openConversation(conv._id || conv.id, conv);
      } catch (e) {
        toast(e?.message || "Tạo nhóm thất bại");
      }
    });
  }

  // ========== MENU NHANH CHO HỘI THOẠI NHÓM ==========
  document.addEventListener(
    "contextmenu",
    (e) => {
      const li = e.target.closest?.("li[data-id]");
      if (!li) return;
      const convId = li.dataset.id;
      const isGroup = (li.querySelector(".avatar")?.textContent || "") === "👥";
      if (!isGroup) return;
      e.preventDefault();

      const action = prompt(
        "Chọn thao tác nhóm:\n" +
          "1 = Đổi tên nhóm\n" +
          "2 = Thêm thành viên\n" +
          "3 = Xoá thành viên\n" +
          "4 = Rời nhóm\n" +
          "(ESC để huỷ)"
      );
      if (!action) return;

      if (String(currentConv) !== String(convId)) {
        const c = { _id: convId, type: "group" };
        openConversation(convId, c);
      }

      switch (String(action).trim()) {
        case "1":
          renameGroupFlow();
          break;
        case "2":
          addMembersFlow();
          break;
        case "3":
          removeMemberFlow();
          break;
        case "4":
          leaveGroupFlow();
          break;
        default:
          break;
      }
    },
    false
  );

  // ===== Modal Cài đặt Nhóm + Cài đặt Chat Cá nhân =====
  const groupSettingsBtn = document.getElementById("groupSettingsBtn");
  const groupSettingsModal = document.getElementById("groupSettingsModal");
  const searchFriendBtn = document.getElementById("searchFriendBtn");
  const friendSearchModal = document.getElementById("friendSearchModal");
  const requestsBtn = document.getElementById("requestsBtn");
  const requestCountEl = document.getElementById("requestCount");
  const friendRequestsModal = document.getElementById("friendRequestsModal");
  const friendRequestList = document.getElementById("friendRequestList");
  const closeFriendRequestsBtn = document.getElementById(
    "closeFriendRequestsBtn"
  );
  const friendSearchInput = document.getElementById("friendSearchInput");
  const doFriendSearchBtn = document.getElementById("doFriendSearchBtn");
  const friendSearchResultList = document.getElementById(
    "friendSearchResultList"
  );
  const closeFriendSearchBtn = document.getElementById("closeFriendSearchBtn");
  const renameGroupBtn = document.getElementById("renameGroupBtn");
  const addMemberBtn = document.getElementById("addMemberBtn");
  const removeMemberBtn = document.getElementById("removeMemberBtn");
  const leaveGroupBtn = document.getElementById("leaveGroupBtn");
  const closeGroupSettingsBtn = document.getElementById(
    "closeGroupSettingsBtn"
  );

  // Elements for direct chat settings (must exist in your index.ejs)
  const directSettingsModal = document.getElementById("directSettingsModal");
  const unfriendBtn = document.getElementById("unfriendBtn");
  const blockBtn = document.getElementById("blockBtn");
  const closeDirectSettingsBtn = document.getElementById("closeDirectSettingsBtn");

  function openDirectSettings() {
    if (!currentConv || currentConvIsGroup) return;
    if (!directSettingsModal) return toast("Không có modal cài đặt bạn bè");
    directSettingsModal.classList.remove("hidden");
  }

  function closeDirectSettings() {
    if (!directSettingsModal) return;
    directSettingsModal.classList.add("hidden");
  }

  unfriendBtn?.addEventListener("click", async () => {
    closeDirectSettings();
    if (!currentPeer?._id) return toast("Không xác định được người dùng");
    if (confirm(`Huỷ kết bạn với ${currentPeer.name}?`)) {
      await cancelFriendship(currentPeer._id);
    }
  });
  blockBtn?.addEventListener("click", async () => {
    closeDirectSettings();
    if (!currentPeer?._id) return toast("Không xác định được người dùng");
    if (confirm(`Chặn ${currentPeer.name}?`)) {
      await blockUser(currentPeer._id);
    }
  });
  closeDirectSettingsBtn?.addEventListener("click", closeDirectSettings);

  // Mở modal cài đặt: nếu là nhóm -> mở modal nhóm; nếu là chat cá nhân -> mở direct modal
  async function openGroupSettings() {
    if (!currentConv) {
      toast("Chọn cuộc trò chuyện trước đã");
      return;
    }

    if (currentConvIsGroup) {
      if (!groupSettingsModal) return toast("Không có modal cài đặt nhóm");
      groupSettingsModal.classList.remove("hidden");
      return;
    } else {
      openDirectSettings();
      return;
    }
  }

  // Gọi API huỷ kết bạn (nhiều backend dùng endpoint khác nhau)
async function cancelFriendship(userId) {
  try {
    const res = await fetch("/api/friends/unfriend", {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(localStorage.getItem("TOKEN") ? { Authorization: "Bearer " + localStorage.getItem("TOKEN") } : {}),
      },
      body: JSON.stringify({ friendId: userId }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.message || `HTTP ${res.status}`);
    }
    toast("Đã huỷ kết bạn");
    await loadConversations();
    await loadFriendsAndCache();
  } catch (e) {
    toast(e?.message || "Huỷ kết bạn thất bại");
  }
}


  // Gọi API chặn user (nhiều backend có endpoint khác nhau)
  async function blockUser(userId) {
    try {
      const tries = [
        () => API.post("/api/friends/block", { to: userId }),
        () => API.post("/api/users/block", { userId }),
        () => API.post("/api/block", { target: userId }),
      ];
      let ok = false, lastErr = null;
      for (const fn of tries) {
        try {
          await fn();
          ok = true;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (ok) {
        toast("Đã chặn người dùng");
        if (currentConv) {
          currentConv = null;
          if (messagesEl) messagesEl.innerHTML = "";
          peerNameEl.textContent = "Chọn một cuộc trò chuyện";
          peerAvatarEl.textContent = "🙂";
          peerStatusEl.textContent = "—";
        }
        await loadConversations();
      } else {
        throw lastErr || new Error("Không thể chặn người dùng");
      }
    } catch (e) {
      toast(e?.message || "Chặn thất bại");
    }
  }

  function closeGroupSettings() {
    groupSettingsModal.classList.add("hidden");
  }

  groupSettingsBtn?.addEventListener("click", openGroupSettings);
  closeGroupSettingsBtn?.addEventListener("click", closeGroupSettings);

  // Gắn hành động từng nút
  renameGroupBtn?.addEventListener("click", async () => {
    closeGroupSettings();
    await renameGroupFlow();
  });
  addMemberBtn?.addEventListener("click", async () => {
    closeGroupSettings();
    await addMembersFlow();
  });
  removeMemberBtn?.addEventListener("click", async () => {
    closeGroupSettings();
    await removeMemberFlow();
  });
  leaveGroupBtn?.addEventListener("click", async () => {
    closeGroupSettings();
    await leaveGroupFlow();
  });

  // ====== TÌM KIẾM BẠN BÈ & KẾT BẠN ======
  function openFriendSearchModal() {
    if (!friendSearchModal) return;
    friendSearchModal.classList.remove("hidden");
    friendSearchInput.value = "";
    friendSearchResultList.innerHTML = `<div style='padding:10px'>Tìm kiếm để bắt đầu...</div>`;
    friendSearchInput.focus();
  }

  function closeFriendSearchModal() {
    if (!friendSearchModal) return;
    friendSearchModal.classList.add("hidden");
  }

  async function handleFriendSearch() {
    const q = friendSearchInput.value.trim();
    if (!q) {
      friendSearchResultList.innerHTML = `<div style='padding:10px'>Vui lòng nhập từ khoá tìm kiếm.</div>`;
      return;
    }
    friendSearchResultList.innerHTML = `<div style='padding:10px'>Đang tìm kiếm...</div>`;

    try {
      const res = await API.get(`/api/user/list?q=${encodeURIComponent(q)}`);
      const list = res?.items || res?.users || res || [];
      const meId = String(ME_ID);

      if (!list.length) {
        friendSearchResultList.innerHTML = `<div style='padding:10px'>Không tìm thấy người dùng nào phù hợp.</div>`;
        return;
      }

      friendSearchResultList.innerHTML = list
        .filter((u) => String(u._id || u.id) !== meId)
        .map((u) => {
          const userId = u._id || u.id;
          const isFriend = FRIEND_IDS.has(String(userId)); // <== KIỂM TRA BẠN BÈ

          const infoText = isFriend ? `(Bạn bè)` : u.username || u.email || "";

          const actionButton = isFriend
            ? `<button class="btn primary small start-chat-btn" data-id="${userId}">Nhắn tin</button>`
            : `<button class="btn outline small send-friend-req" data-id="${userId}">Kết bạn</button>`;

          return `
          <div class="user-item-result" data-id="${userId}">
            <div class="avatar small">${getInitial(
              u.name || u.username || "U"
            )}</div>
            <div class="info">
              <div class="name">${u.name || u.username || "Không tên"}</div>
              <div class="detail">${infoText}</div>
            </div>
            ${actionButton}
          </div>
        `;
        })
        .join("");
    } catch {
      friendSearchResultList.innerHTML = `<div style='padding:10px;color:red'>Lỗi tải danh sách tìm kiếm.</div>`;
    }
  }

  async function sendFriendRequest(userId, buttonEl) {
    if (!userId || !ME_ID) return;
    try {
      await API.post("/api/friends/send", { to: userId });
      toast("Đã gửi yêu cầu kết bạn!");
      if (buttonEl) {
        buttonEl.textContent = "Đã gửi";
        buttonEl.disabled = true;
        buttonEl.classList.remove("outline");
        buttonEl.classList.add("disabled");
      }
    } catch (e) {
      toast(e?.message || "Không thể gửi yêu cầu kết bạn");
    }
  }

  async function startChatWithFriend(friendId) {
    if (!friendId || !ME_ID) return;
    try {
      const conv = await API.post("/api/conversations/private", {
        otherUserId: friendId,
      });

      const convId =
        conv?._id || conv?.id || conv?.conversationId || conv?.data?._id;

      if (convId) {
        toast("Mở trò chuyện thành công!");
        closeFriendSearchModal();
        await loadConversations();
        openConversation(convId, conv);
      } else {
        throw new Error("Phản hồi từ Server không có ID hội thoại hợp lệ.");
      }
    } catch (e) {
      toast(e?.message || "Không thể tạo/mở đoạn chat. (Lỗi API/Server)");
      console.error("Lỗi mở chat:", e);
    }
  }

  // BINDING cho Tìm kiếm Bạn bè
  searchFriendBtn?.addEventListener("click", openFriendSearchModal);
  closeFriendSearchBtn?.addEventListener("click", closeFriendSearchModal);
  friendSearchModal?.addEventListener("click", (e) => {
    if (e.target === friendSearchModal) closeFriendSearchModal();
  });

  doFriendSearchBtn?.addEventListener("click", handleFriendSearch);
  friendSearchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleFriendSearch();
    }
  });

  // Delegate event listener cho nút Kết bạn
  friendSearchResultList?.addEventListener("click", (e) => {
    const chatBtn = e.target.closest(".start-chat-btn");
    const sendReqBtn = e.target.closest(".send-friend-req");

    if (chatBtn) {
      const userId = chatBtn.dataset.id;
      startChatWithFriend(userId);
      return;
    }

    if (sendReqBtn) {
      const userId = sendReqBtn.dataset.id;
      sendFriendRequest(userId, sendReqBtn);
      return;
    }
  });

  // ====== YÊU CẦU KẾT BẠN ĐẾN ======
  function openFriendRequestsModal() {
    if (!friendRequestsModal) return;
    friendRequestsModal.classList.remove("hidden");
    loadFriendRequests();
  }

  function closeFriendRequestsModal() {
    if (!friendRequestsModal) return;
    friendRequestsModal.classList.add("hidden");
  }

  async function loadFriendRequests() {
    if (!friendRequestList) return;
    friendRequestList.innerHTML = `<div style='padding:10px'>Đang tải yêu cầu...</div>`;
    requestCountEl.textContent = "0";

    try {
      const res = await API.get("/api/friends/requests");
      const requests = res?.incoming || [];
      if (!requests || !requests.length) {
        friendRequestList.innerHTML = `<div style='padding:10px'>Không có yêu cầu kết bạn nào đang chờ.</div>`;
        return;
      }

      requestCountEl.textContent = requests.length;

      friendRequestList.innerHTML = requests
        .map((req) => {
          const sender = req.from;
          const name = sender.name || sender.username || "Không tên";
          const detail = sender.username || sender.email || "";

          const fromId = sender._id || sender.id;

          return `
            <div class="user-item-result request-item" data-request-id="${req._id}">
                <div class="avatar small">${getInitial(name)}</div>
                <div class="info">
                    <div class="name">${name}</div>
                    <div class="detail">Gửi yêu cầu: ${detail}</div>
                </div>
                <div class="actions">
                    <button class="btn primary small respond-req-accept" 
                            data-request-id="${req._id}" 
                            data-from-id="${fromId}">Đồng ý</button>
                    <button class="btn danger small respond-req-reject" 
                            data-request-id="${req._id}"
                            data-from-id="${fromId}">Từ chối</button>
                </div>
            </div>
        `;
        })
        .join("");
    } catch (e) {
      friendRequestList.innerHTML = `<div style='padding:10px;color:red'>Lỗi tải danh sách yêu cầu.</div>`;
    }
  }

  async function handleFriendResponse(fromId, action, requestItemEl) {
    if (!fromId || !["accept", "reject"].includes(action)) return;

    try {
      await API.post("/api/friends/respond", { from: fromId, action });

      toast(`Đã ${action === "accept" ? "chấp nhận" : "từ chối"} yêu cầu!`);

      requestItemEl?.remove();

      const currentCount = parseInt(requestCountEl.textContent) || 0;
      requestCountEl.textContent = Math.max(0, currentCount - 1);

      if (action === "accept") {
        await loadConversations();
      }
    } catch (e) {
      toast(e?.message || "Lỗi xử lý yêu cầu");
    }
  }

  // BINDING cho Yêu cầu Kết bạn
  requestsBtn?.addEventListener("click", openFriendRequestsModal);
  closeFriendRequestsBtn?.addEventListener("click", closeFriendRequestsModal);
  friendRequestsModal?.addEventListener("click", (e) => {
    if (e.target === friendRequestsModal) closeFriendRequestsModal();
  });

  friendRequestList?.addEventListener("click", (e) => {
    const acceptBtn = e.target.closest(".respond-req-accept");
    const rejectBtn = e.target.closest(".respond-req-reject");

    if (acceptBtn || rejectBtn) {
      const btn = acceptBtn || rejectBtn;
      const fromId = btn.dataset.fromId;
      const action = acceptBtn ? "accept" : "reject";

      const requestItemEl = btn.closest(".request-item");
      handleFriendResponse(fromId, action, requestItemEl);
    }
  });

})();
