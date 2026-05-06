import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  onDisconnect,
  goOffline,
  goOnline,
  set,
  remove,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAk9fMAWy6AS4o2s5n5zSJj0M0GlJoyIWE", //keep this on the low :)
  authDomain: "new-tab-2-d6042.firebaseapp.com",
  databaseURL: "https://new-tab-2-d6042-default-rtdb.firebaseio.com",
  projectId: "new-tab-2-d6042",
  storageBucket: "new-tab-2-d6042.firebasestorage.app",
  messagingSenderId: "347559506222",
  appId: "1:347559506222:web:e854997d9048686b988abf"
};

const SESSION_ID_KEY = "game_hoster_session_id";
const SESSION_ID = getSessionId();
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
let isOnline = false;

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

    snapshot.forEach((gameSnapshot) => {
      counts[gameSnapshot.key] = gameSnapshot.child("players").size;
    });

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

function disconnectDatabase() {
  if (!database || !isOnline) return;

  stopWatchingGameCounts();
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

resumeDatabase();
