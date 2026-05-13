import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  onDisconnect,
  push,
  query,
  limitToLast,
  goOffline,
  goOnline,
  set,
  remove,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAk9fMAWy6AS4o2s5n5zSJj0M0GlJoyIWE", //hardcoded to assert Dominance 
  authDomain: "new-tab-2-d6042.firebaseapp.com",
  databaseURL: "https://new-tab-2-d6042-default-rtdb.firebaseio.com",
  projectId: "new-tab-2-d6042",
  storageBucket: "new-tab-2-d6042.firebasestorage.app",
  messagingSenderId: "347559506222",
  appId: "1:347559506222:web:e854997d9048686b988abf"
};

const SESSION_ID_KEY = "game_hoster_session_id";
const SESSION_ID = getSessionId();
const CHAT_NAME_KEY = "site_chat_name";
const CHAT_MESSAGE_LIMIT = 40;
const MAX_MESSAGE_LENGTH = 240;
const MAX_NAME_LENGTH = 24;

// Customize these two lists for your chat filter.
const CENSOR_WORDS = [
  "badword",
  "anotherbadword"
];

const CENSOR_REPLACEMENTS = [
  "I need to rethink that message.",
  "That got filtered.",
  "Let's keep the chat clean."
];

const isConfigured = !Object.values(firebaseConfig).some((value) => value.includes("PASTE_YOUR"));

if (!isConfigured) {
  console.warn("Add your Firebase web app config in firebase-presence.js to enable live player counts.");
}

const app = isConfigured ? initializeApp(firebaseConfig) : null;
const database = app ? getDatabase(app) : null;

let activeGameId = null;
let activeGameName = null;
let activePresenceRef = null;
let activeDisconnectRef = null;
let unsubscribeCounts = null;
let unsubscribeChat = null;
let isOnline = false;
let chatLoaded = false;
let latestRenderedMessageKey = null;

const chatToggle = document.getElementById("chatToggle");
const siteChat = document.getElementById("siteChat");
const chatActiveUsers = document.getElementById("chatActiveUsers");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatName = document.getElementById("chatName");
const chatInput = document.getElementById("chatInput");
const chatSend = document.getElementById("chatSend");

function getSessionId() {
  let id = sessionStorage.getItem(SESSION_ID_KEY);

  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_ID_KEY, id);
  }

  return id;
}

function gameIdFromName(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "game";
}

function setActiveGame(name) {
  if (!database) return;

  const gameId = gameIdFromName(name);
  activeGameName = name;

  if (document.visibilityState === "hidden") return;

  if (gameId === activeGameId) return;

  clearActivePresence({ cancelDisconnect: true });
  connectDatabase();

  activeGameId = gameId;
  activePresenceRef = ref(database, `gamePresence/${gameId}/players/${SESSION_ID}`);
  activeDisconnectRef = onDisconnect(activePresenceRef);

  activeDisconnectRef.remove().catch(() => {});

  set(activePresenceRef, {
    game: name,
    joinedAt: serverTimestamp(),
    lastSeenAt: serverTimestamp()
  }).catch(() => {});
}

function watchGameCounts() {
  if (!database) return;
  if (unsubscribeCounts) return;

  connectDatabase();

  const countsRef = ref(database, "gamePresence");

  unsubscribeCounts = onValue(countsRef, (snapshot) => {
    const counts = {};
    let totalPlayers = 0;

    snapshot.forEach((gameSnapshot) => {
      const playerCount = gameSnapshot.child("players").size;
      counts[gameSnapshot.key] = playerCount;
      totalPlayers += playerCount;
    });

    updateActiveUsers(totalPlayers);

    document.querySelectorAll("[data-player-count-for]").forEach((badge) => {
      const gameId = gameIdFromName(badge.dataset.playerCountFor);
      const playerCount = counts[gameId] || 0;

      badge.textContent = playerCount > 0 ? playerCount : "";
      badge.classList.toggle("has-players", playerCount > 0);
      badge.title = playerCount > 0
        ? `${playerCount} player${playerCount === 1 ? "" : "s"} online`
        : "No players online";
    });
  });
}

function updateActiveUsers(totalPlayers) {
  if (!chatActiveUsers) return;

  chatActiveUsers.textContent = `${totalPlayers} active`;
  chatActiveUsers.title = `${totalPlayers} active user${totalPlayers === 1 ? "" : "s"} across games`;
}

function setupChat() {
  if (!chatToggle || !siteChat || !chatForm || !chatName || !chatInput) return;

  chatName.value = cleanName(localStorage.getItem(CHAT_NAME_KEY) || "");

  chatToggle.addEventListener("click", toggleChat);
  chatName.addEventListener("input", () => {
    localStorage.setItem(CHAT_NAME_KEY, cleanName(chatName.value));
  });

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendChatMessage();
  });

  if (!database && chatSend) {
    chatSend.disabled = true;
    chatInput.placeholder = "Chat needs Firebase first";
  }
}

function toggleChat() {
  const willOpen = !siteChat.classList.contains("open");

  siteChat.classList.toggle("open", willOpen);
  chatToggle.classList.toggle("open", willOpen);
  chatToggle.textContent = willOpen ? "›" : "‹";
  chatToggle.setAttribute("aria-label", willOpen ? "Close chat" : "Open chat");
  chatToggle.title = willOpen ? "Close chat" : "Open chat";

  if (willOpen) {
    watchChatMessages();
    chatInput?.focus();
  }
}

function watchChatMessages() {
  if (!database || unsubscribeChat) return;

  connectDatabase();

  const messagesRef = query(ref(database, "siteChat/messages"), limitToLast(CHAT_MESSAGE_LIMIT));

  unsubscribeChat = onValue(messagesRef, (snapshot) => {
    if (!chatMessages) return;

    chatMessages.innerHTML = "";

    if (!snapshot.exists()) {
      latestRenderedMessageKey = null;
      chatMessages.innerHTML = '<div class="chat-empty">No messages yet.</div>';
      return;
    }

    snapshot.forEach((messageSnapshot) => {
      latestRenderedMessageKey = messageSnapshot.key;
      renderMessage(messageSnapshot.key, messageSnapshot.val());
    });

    chatLoaded = true;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

function renderMessage(key, message) {
  if (!chatMessages || !message) return;

  const item = document.createElement("div");
  item.className = `chat-message${message.sid === SESSION_ID ? " own" : ""}`;
  item.dataset.messageKey = key;

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const name = document.createElement("span");
  name.className = "message-name";
  name.textContent = cleanName(message.name) || "Guest";

  const time = document.createElement("span");
  time.textContent = formatMessageTime(message.createdAt);

  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = cleanMessageText(message.text);

  meta.append(name, time);
  item.append(meta, text);
  chatMessages.appendChild(item);
}

function sendChatMessage() {
  if (!database || !chatInput || !chatName) return;

  const rawText = chatInput.value.trim();
  if (!rawText) return;

  const name = cleanName(chatName.value) || `Guest-${SESSION_ID.slice(0, 4)}`;
  const text = applyCensor(rawText);

  chatName.value = name;
  localStorage.setItem(CHAT_NAME_KEY, name);
  chatInput.value = "";

  connectDatabase();

  push(ref(database, "siteChat/messages"), {
    name,
    text,
    sid: SESSION_ID,
    createdAt: serverTimestamp()
  }).catch(() => {
    chatInput.value = rawText;
  });
}

function applyCensor(text) {
  const cleaned = cleanMessageText(text);

  if (!CENSOR_WORDS.length || !CENSOR_REPLACEMENTS.length) {
    return cleaned;
  }

  const hasBlockedWord = CENSOR_WORDS.some((word) => {
    const normalizedWord = String(word || "").trim();
    if (!normalizedWord) return false;

    return new RegExp(`\\b${escapeRegExp(normalizedWord)}\\b`, "i").test(cleaned);
  });

  if (!hasBlockedWord) return cleaned;

  const randomIndex = Math.floor(Math.random() * CENSOR_REPLACEMENTS.length);
  return cleanMessageText(CENSOR_REPLACEMENTS[randomIndex] || "Message filtered.");
}

function cleanMessageText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

function cleanName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatMessageTime(timestamp) {
  if (!timestamp || typeof timestamp !== "number") return "now";

  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function connectDatabase() {
  if (!database || isOnline) return;

  goOnline(database);
  isOnline = true;
}

function clearActivePresence({ cancelDisconnect = false } = {}) {
  if (activeDisconnectRef && cancelDisconnect) {
    activeDisconnectRef.cancel().catch(() => {});
    activeDisconnectRef = null;
  }

  if (activePresenceRef) {
    remove(activePresenceRef).catch(() => {});
    activePresenceRef = null;
  }

  activeDisconnectRef = null;
  activeGameId = null;
}

function stopWatchingGameCounts() {
  if (!unsubscribeCounts) return;

  unsubscribeCounts();
  unsubscribeCounts = null;
}

function stopWatchingChat() {
  if (!unsubscribeChat) return;

  unsubscribeChat();
  unsubscribeChat = null;
  chatLoaded = false;
  latestRenderedMessageKey = null;
}

function disconnectDatabase() {
  if (!database || !isOnline) return;

  stopWatchingGameCounts();
  stopWatchingChat();
  clearActivePresence();
  goOffline(database);
  isOnline = false;
}

function resumeDatabase() {
  if (!database || document.visibilityState === "hidden") return;

  watchGameCounts();

  if (activeGameName) {
    setActiveGame(activeGameName);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    disconnectDatabase();
  } else {
    resumeDatabase();
  }
});

window.addEventListener("pagehide", disconnectDatabase);
window.addEventListener("beforeunload", disconnectDatabase);

window.gamePresence = {
  setActiveGame,
  disconnect: disconnectDatabase
};

setupChat();
resumeDatabase();
