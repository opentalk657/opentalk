
/**
 * OpenTalk V1 (Firebase compat)
 * - Users: /users/{uid}
 * - Blocks: /users/{uid}/blocks/{otherUid}
 * - Requests: /requests/{requestId}
 * - Chats: /chats/{chatId} (type: 'dm' | 'group')
 * - Messages: /chats/{chatId}/messages/{msgId}
 * - Groups: /groups/{groupId}
 *
 * Design goals:
 * - fast feedback
 * - consent
 * - text-only
 * - panic button
 */

const $ = (id)=>document.getElementById(id);

const profanity = [
  // mini-list (à enrichir). Objectif: bloquer les messages sexualisés/vulgaires.
  "pute","encul","salope","bite","chatte","foutre","seins","cul","fesses","baise","porn","sexe","nude","nudes",
  "pussy","dick","cock","sex","porn","ass","tits","boobs","naked"
];

function normalize(s){
  return (s||"").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ");
}

function containsBanned(text){
  const t = " " + normalize(text) + " ";
  return profanity.some(w => t.includes(" " + w + " "));
}

function nowTs(){ return firebase.firestore.Timestamp.now(); }

function daysBetween(a, b){
  const ms = Math.abs(b - a);
  return ms / (1000*60*60*24);
}

let state = {
  me: null,
  meDoc: null,
  activeChatId: null,
  activeChatType: null,
  activePeerUid: null,
  unsub: []
};

function clearSubs(){
  state.unsub.forEach(fn=>{ try{fn();}catch(e){} });
  state.unsub = [];
}

function setAuthMsg(msg){ $("authMsg").textContent = msg||""; }

async function ensureUserDoc(user, displayName){
  const ref = db.collection("users").doc(user.uid);
  const snap = await ref.get();
  const base = {
    uid: user.uid,
    email: user.email || null,
    displayName: displayName || user.displayName || "OpenTalker",
    status: "RED", // default safe
    isVisible: false,
    lastActiveAt: nowTs(),
    createdAt: nowTs(),
    lastReconfirmAt: nowTs(), // weekly reconfirm
    respondScore: 0 // simple signal: answers vs ignores (v1 simplistic)
  };
  if(!snap.exists){
    await ref.set(base);
  }else{
    // update lastActive, keep existing fields
    await ref.set({ lastActiveAt: nowTs() }, { merge:true });
  }
  return ref;
}

function showApp(isIn){
  $("authPanel").classList.toggle("hidden", isIn);
  $("mainPanel").classList.toggle("hidden", !isIn);
  $("logoutBtn").classList.toggle("hidden", !isIn);
}

async function signUp(){
  const email = $("email").value.trim();
  const password = $("password").value;
  const displayName = $("displayName").value.trim() || "OpenTalker";
  if(!$("adultCheck").checked){
    setAuthMsg("Merci de confirmer que tu as au moins 18 ans.");
    return;
  }
  if(!email || password.length < 6){
    setAuthMsg("Email requis et mot de passe (6+ caractères).");
    return;
  }
  setAuthMsg("");
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  await cred.user.updateProfile({ displayName });
  await ensureUserDoc(cred.user, displayName);
}

async function login(){
  const email = $("email").value.trim();
  const password = $("password").value;
  if(!email || !password){
    setAuthMsg("Email et mot de passe requis.");
    return;
  }
  setAuthMsg("");
  await auth.signInWithEmailAndPassword(email, password);
}

async function logout(){
  clearSubs();
  await auth.signOut();
  showApp(false);
}

async function setStatus(status){
  if(!state.me) return;
  const isVisible = (status !== "RED");
  await db.collection("users").doc(state.me.uid).set({
    status,
    isVisible,
    lastActiveAt: nowTs()
  }, {merge:true});
}

function statusPill(status){
  if(status === "GREEN") return `<span class="pill green">🟢 Disponible</span>`;
  if(status === "YELLOW") return `<span class="pill yellow">🟡 Plus tard</span>`;
  return `<span class="pill red">🔴 Pas dispo</span>`;
}

async function isBlocked(otherUid){
  if(!state.me) return false;
  const meBlock = await db.collection("users").doc(state.me.uid).collection("blocks").doc(otherUid).get();
  if(meBlock.exists) return true;
  const themBlock = await db.collection("users").doc(otherUid).collection("blocks").doc(state.me.uid).get();
  if(themBlock.exists) return true;
  return false;
}

function chatIdFor(u1, u2){
  return [u1, u2].sort().join("_");
}

async function sendRequest(toUid){
  const blocked = await isBlocked(toUid);
  if(blocked){
    alert("Impossible : blocage actif.");
    return;
  }
  // limit naive: max 5 outgoing in 24h
  const since = new Date(Date.now() - 24*60*60*1000);
  const q = await db.collection("requests")
    .where("fromUid","==",state.me.uid)
    .where("createdAt",">=",firebase.firestore.Timestamp.fromDate(since))
    .get();
  if(q.size >= 5){
    alert("Limite atteinte aujourd’hui. Reviens plus tard.");
    return;
  }

  const msg = prompt("Mini message (1–2 lignes) :") || "";
  const duration = prompt("Durée proposée (10 / 20 / 30) :", "10") || "10";
  const cleanMsg = msg.trim().slice(0,200);

  if(containsBanned(cleanMsg)){
    alert("Message bloqué : contenu déplacé non autorisé sur OpenTalk.");
    // increment strike
    await strike(state.me.uid, "banned_message");
    return;
  }

  await db.collection("requests").add({
    fromUid: state.me.uid,
    fromName: state.meDoc?.displayName || "Quelqu’un",
    toUid,
    msg: cleanMsg,
    duration,
    status: "PENDING", // PENDING | ACCEPTED | LATER | DECLINED | EXPIRED
    createdAt: nowTs(),
    expiresAt: firebase.firestore.Timestamp.fromDate(new Date(Date.now() + 10*60*1000)) // 10 min
  });

  alert("Demande envoyée. Tu auras un retour rapide.");
}

async function strike(uid, reason){
  const ref = db.collection("users").doc(uid);
  // 1 warning then ban (soft): in v1 we just set canPost=false after 2
  await db.runTransaction(async (tx)=>{
    const s = await tx.get(ref);
    const data = s.data() || {};
    const strikes = (data.strikes || 0) + 1;
    const update = { strikes, lastStrikeAt: nowTs(), lastStrikeReason: reason };
    if(strikes >= 2){
      update.isBanned = true;
      update.bannedAt = nowTs();
    }
    tx.set(ref, update, {merge:true});
  });
}

async function acceptRequest(requestId, mode){
  // mode: ACCEPTED | LATER | DECLINED
  const ref = db.collection("requests").doc(requestId);
  const snap = await ref.get();
  if(!snap.exists) return;
  const r = snap.data();
  if(r.toUid !== state.me.uid) return;

  // update request
  await ref.set({ status: mode, respondedAt: nowTs() }, {merge:true});

  if(mode === "ACCEPTED"){
    // create/open dm chat
    const chatId = chatIdFor(r.fromUid, r.toUid);
    await db.collection("chats").doc(chatId).set({
      type:"dm",
      members:[r.fromUid, r.toUid],
      createdAt: nowTs(),
      lastMsgAt: nowTs()
    }, {merge:true});

    // send welcome message
    await db.collection("chats").doc(chatId).collection("messages").add({
      fromUid: state.me.uid,
      fromName: state.meDoc?.displayName || "Moi",
      text: "✅ Discussion acceptée. Merci de rester respectueux 🙂",
      createdAt: nowTs()
    });

    openChatDM(r.fromUid, r.fromName, chatId);
  }
}

function renderPeople(list){
  const el = $("peopleList");
  el.innerHTML = "";
  list.forEach(u=>{
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="topline">
        <div><strong>${escapeHtml(u.displayName||"OpenTalker")}</strong></div>
        ${statusPill(u.status)}
      </div>
      <div class="fine">Répond vite · Discussion consentie</div>
      <div style="margin-top:8px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" data-action="request" data-uid="${u.uid}">Demander à discuter</button>
        <button class="btn ghost" data-action="open" data-uid="${u.uid}">Ouvrir chat</button>
      </div>
    `;
    el.appendChild(div);
  });

  el.querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const uid = btn.getAttribute("data-uid");
      const act = btn.getAttribute("data-action");
      if(uid === state.me.uid) return;
      if(act === "request") await sendRequest(uid);
      if(act === "open"){
        const chatId = chatIdFor(uid, state.me.uid);
        openChatDM(uid, "Discussion", chatId);
      }
    });
  });
}

function renderInbox(items){
  const el = $("inbox");
  el.innerHTML = "";
  items.forEach(r=>{
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="topline">
        <div><strong>${escapeHtml(r.fromName||"Quelqu’un")}</strong></div>
        <span class="pill">${escapeHtml(r.duration||"10")} min</span>
      </div>
      <div style="margin:8px 0">${escapeHtml(r.msg||"")}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" data-id="${r.id}" data-mode="ACCEPTED">✅ Discuter</button>
        <button class="btn" data-id="${r.id}" data-mode="LATER">🕒 Plus tard</button>
        <button class="btn danger" data-id="${r.id}" data-mode="DECLINED">❌ Non merci</button>
      </div>
      <div class="fine">Réponse rapide = fin du doute.</div>
    `;
    el.appendChild(div);
  });

  el.querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      await acceptRequest(btn.getAttribute("data-id"), btn.getAttribute("data-mode"));
    });
  });
}

function renderGroups(groups){
  const el = $("groupList");
  el.innerHTML = "";
  groups.forEach(g=>{
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="topline">
        <div><strong># ${escapeHtml(g.name||"groupe")}</strong></div>
        <span class="pill">${g.memberCount||0} membres</span>
      </div>
      <div style="margin-top:8px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" data-act="join" data-id="${g.id}">Rejoindre</button>
        <button class="btn ghost" data-act="open" data-id="${g.id}">Ouvrir</button>
      </div>
      <div class="fine">Respect obligatoire · 🔴 stop possible</div>
    `;
    el.appendChild(div);
  });

  el.querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.getAttribute("data-id");
      const act = btn.getAttribute("data-act");
      if(act === "join") await joinGroup(id);
      if(act === "open") await openGroup(id);
    });
  });
}

async function createGroup(){
  const name = $("groupName").value.trim();
  if(!name) return;
  if(containsBanned(name)){
    alert("Nom de groupe refusé.");
    return;
  }
  const ref = await db.collection("groups").add({
    name: name.slice(0,40),
    ownerUid: state.me.uid,
    createdAt: nowTs(),
    isPublic: true
  });
  // add membership
  await db.collection("groups").doc(ref.id).collection("members").doc(state.me.uid).set({
    uid: state.me.uid,
    joinedAt: nowTs(),
    role: "owner"
  });
  $("groupName").value = "";
}

async function joinGroup(groupId){
  const mref = db.collection("groups").doc(groupId).collection("members").doc(state.me.uid);
  const ms = await mref.get();
  if(ms.exists) return;
  await mref.set({ uid: state.me.uid, joinedAt: nowTs(), role:"member" });
  alert("Rejoint !");
}

async function openGroup(groupId){
  const g = await db.collection("groups").doc(groupId).get();
  if(!g.exists) return;
  // ensure member
  await joinGroup(groupId);
  const chatId = "group_" + groupId;
  await db.collection("chats").doc(chatId).set({
    type:"group",
    groupId,
    members: [], // not enumerated in v1
    createdAt: nowTs(),
    lastMsgAt: nowTs()
  }, {merge:true});
  state.activeChatId = chatId;
  state.activeChatType = "group";
  state.activePeerUid = null;
  $("chatTitle").textContent = "# " + (g.data().name||"groupe");
  $("panicBtn").classList.remove("hidden");
  listenMessages(chatId);
}

function openChatDM(peerUid, peerName, chatId){
  state.activeChatId = chatId;
  state.activeChatType = "dm";
  state.activePeerUid = peerUid;
  $("chatTitle").textContent = peerName ? ("Discussion avec " + peerName) : "Discussion";
  $("panicBtn").classList.remove("hidden");
  listenMessages(chatId);
}

function listenMessages(chatId){
  // clear previous
  state.unsub = state.unsub.filter(()=>false);
  $("chatBox").innerHTML = "";
  const unsub = db.collection("chats").doc(chatId).collection("messages")
    .orderBy("createdAt","asc")
    .limit(200)
    .onSnapshot(async (snap)=>{
      // if dm, check blocks and lock UI
      if(state.activeChatType === "dm" && state.activePeerUid){
        const blocked = await isBlocked(state.activePeerUid);
        if(blocked){
          $("chatInput").disabled = true;
          $("sendBtn").disabled = true;
        }else{
          $("chatInput").disabled = false;
          $("sendBtn").disabled = false;
        }
      }
      const box = $("chatBox");
      box.innerHTML = "";
      snap.forEach(doc=>{
        const m = doc.data();
        const me = (m.fromUid === state.me.uid);
        const row = document.createElement("div");
        row.className = "msg" + (me ? " me" : "");
        row.innerHTML = `
          <div class="meta">${escapeHtml(m.fromName||"")}</div>
          <div class="bubble">${escapeHtml(m.text||"")}</div>
        `;
        box.appendChild(row);
      });
      box.scrollTop = box.scrollHeight;
    });
  state.unsub.push(unsub);
}

async function sendMessage(){
  const text = $("chatInput").value.trim();
  if(!text || !state.activeChatId) return;

  // bans / strikes
  const meSnap = await db.collection("users").doc(state.me.uid).get();
  const meData = meSnap.data() || {};
  if(meData.isBanned){
    alert("Compte bloqué suite à non-respect des règles.");
    return;
  }

  if(containsBanned(text)){
    alert("Message bloqué : contenu déplacé non autorisé sur OpenTalk.");
    await strike(state.me.uid, "banned_message");
    $("chatInput").value = "";
    return;
  }

  // dm safety: check block
  if(state.activeChatType === "dm" && state.activePeerUid){
    const blocked = await isBlocked(state.activePeerUid);
    if(blocked){
      alert("Discussion interrompue (blocage).");
      return;
    }
  }

  await db.collection("chats").doc(state.activeChatId).collection("messages").add({
    fromUid: state.me.uid,
    fromName: state.meDoc?.displayName || "Moi",
    text: text.slice(0,400),
    createdAt: nowTs()
  });
  await db.collection("chats").doc(state.activeChatId).set({ lastMsgAt: nowTs() }, {merge:true});
  $("chatInput").value = "";
}

async function panicStop(){
  if(!state.activeChatId) return;

  if(state.activeChatType === "dm" && state.activePeerUid){
    // block peer instantly
    const other = state.activePeerUid;
    await db.collection("users").doc(state.me.uid).collection("blocks").doc(other).set({
      uid: other, createdAt: nowTs()
    });
    // write system message
    await db.collection("chats").doc(state.activeChatId).collection("messages").add({
      fromUid: state.me.uid,
      fromName: state.meDoc?.displayName || "Moi",
      text: "🔴 Discussion arrêtée. Blocage activé.",
      createdAt: nowTs()
    });
  } else {
    // group: just leave (hide) — v1: local stop
    await db.collection("chats").doc(state.activeChatId).collection("messages").add({
      fromUid: state.me.uid,
      fromName: state.meDoc?.displayName || "Moi",
      text: "🔴 Je quitte la discussion.",
      createdAt: nowTs()
    });
  }

  // clear active chat
  state.activeChatId = null;
  state.activePeerUid = null;
  $("chatTitle").textContent = "Discussion";
  $("chatBox").innerHTML = "";
  $("panicBtn").classList.add("hidden");
}

function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
}

async function checkWeeklyReconfirm(userDoc){
  const last = userDoc.lastReconfirmAt?.toDate?.() || new Date();
  const days = daysBetween(last, new Date());
  if(days >= 7){
    $("reconfirmBox").classList.remove("hidden");
  }else{
    $("reconfirmBox").classList.add("hidden");
  }
}

async function setReconfirm(isYes){
  const ref = db.collection("users").doc(state.me.uid);
  const payload = {
    lastReconfirmAt: nowTs(),
    isVisible: !!isYes
  };
  if(!isYes){
    payload.status = "RED";
  }
  await ref.set(payload, {merge:true});
  $("reconfirmBox").classList.add("hidden");
}

function wireUI(){
  $("signupBtn").addEventListener("click", ()=>signUp().catch(e=>setAuthMsg(e.message)));
  $("loginBtn").addEventListener("click", ()=>login().catch(e=>setAuthMsg(e.message)));
  $("logoutBtn").addEventListener("click", ()=>logout().catch(()=>{}));

  document.querySelectorAll(".statusBtn").forEach(btn=>{
    btn.addEventListener("click", ()=>setStatus(btn.getAttribute("data-status")));
  });

  $("sendBtn").addEventListener("click", ()=>sendMessage().catch(console.error));
  $("chatInput").addEventListener("keydown", (e)=>{
    if(e.key === "Enter") sendMessage().catch(console.error);
  });

  $("panicBtn").addEventListener("click", ()=>panicStop().catch(console.error));

  $("createGroupBtn").addEventListener("click", ()=>createGroup().catch(console.error));
  $("reconfirmYes").addEventListener("click", ()=>setReconfirm(true).catch(console.error));
  $("reconfirmNo").addEventListener("click", ()=>setReconfirm(false).catch(console.error));
}

function listenCore(){
  // people list: visible & not self, prioritize GREEN
  const unsubPeople = db.collection("users")
    .where("isVisible","==",true)
    .orderBy("status") // GREEN, RED, YELLOW not ideal ordering, but okay for V1
    .limit(50)
    .onSnapshot(async (snap)=>{
      const list = [];
      for(const doc of snap.docs){
        const u = doc.data();
        if(u.uid === state.me.uid) continue;
        // hide if blocked either way
        const blocked = await isBlocked(u.uid);
        if(blocked) continue;
        // show only green/yellow
        if(u.status === "GREEN" || u.status === "YELLOW"){
          list.push(u);
        }
      }
      renderPeople(list);
    });
  state.unsub.push(unsubPeople);

  // inbox: requests to me, pending, not expired
  const unsubInbox = db.collection("requests")
    .where("toUid","==",state.me.uid)
    .orderBy("createdAt","desc")
    .limit(20)
    .onSnapshot((snap)=>{
      const items = [];
      const now = new Date();
      snap.forEach(doc=>{
        const r = doc.data();
        if(r.status !== "PENDING") return;
        const exp = r.expiresAt?.toDate?.();
        if(exp && exp < now) return;
        items.push({ id: doc.id, ...r });
      });
      renderInbox(items);
    });
  state.unsub.push(unsubInbox);

  // groups list
  const unsubGroups = db.collection("groups")
    .orderBy("createdAt","desc")
    .limit(30)
    .onSnapshot(async (snap)=>{
      const groups = [];
      for(const doc of snap.docs){
        const g = doc.data();
        // member count (cheap v1)
        const ms = await db.collection("groups").doc(doc.id).collection("members").limit(50).get();
        groups.push({ id: doc.id, ...g, memberCount: ms.size });
      }
      renderGroups(groups);
    });
  state.unsub.push(unsubGroups);

  // keep lastActive
  setInterval(()=>{
    if(!state.me) return;
    db.collection("users").doc(state.me.uid).set({ lastActiveAt: nowTs() }, {merge:true});
  }, 60_000);
}

auth.onAuthStateChanged(async (user)=>{
  if(!user){
    state.me = null;
    state.meDoc = null;
    clearSubs();
    showApp(false);
    return;
  }

  // load user doc
  state.me = user;
  await ensureUserDoc(user);

  const uref = db.collection("users").doc(user.uid);
  const unsubMe = uref.onSnapshot((snap)=>{
    state.meDoc = snap.data() || {};
    if(state.meDoc.isBanned){
      alert("Compte bloqué suite à non-respect des règles.");
      logout();
      return;
    }
    checkWeeklyReconfirm(state.meDoc);
  });
  state.unsub.push(unsubMe);

  showApp(true);
  listenCore();
});

wireUI();
