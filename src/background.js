import { loadConfig, STORAGE_KEY } from "./shared/config.js";
import { buildPacScript } from "./shared/pac.js";

const AUTH_RETRY_LIMIT = 2;
const authAttempts = new Map();
let activeConfig = null;

chrome.runtime.onInstalled.addListener(() => {
  applyStoredConfig();
});

chrome.runtime.onStartup.addListener(() => {
  applyStoredConfig();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]) {
    applyStoredConfig();
  }
});

chrome.proxy.onProxyError.addListener((details) => {
  console.warn("Proxy error", details);
});

chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    handleAuthRequired(details, callback);
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    clearAuthAttempts(details.requestId);
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    clearAuthAttempts(details.requestId);
  },
  { urls: ["<all_urls>"] }
);

applyStoredConfig();

async function applyStoredConfig() {
  activeConfig = await loadConfig();

  if (!activeConfig.enabled) {
    await setProxyConfig({ mode: "direct" });
    updateBadge(false);
    return;
  }

  const pacScript = buildPacScript(activeConfig);
  await setProxyConfig({
    mode: "pac_script",
    pacScript: {
      data: pacScript,
      mandatory: false
    }
  });
  updateBadge(true);
}

function setProxyConfig(value) {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.set({ value, scope: "regular" }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function updateBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#1f8f5f" });
}

function handleAuthRequired(details, callback) {
  if (!details.isProxy || !activeConfig || !activeConfig.enabled) {
    callback({});
    return;
  }

  const challenger = details.challenger || {};
  const proxy = findProxyForChallenge(challenger.host, challenger.port);

  if (!proxy || !proxy.username) {
    callback({});
    return;
  }

  const attemptKey = `${details.requestId}:${proxy.id}`;
  const attempts = authAttempts.get(attemptKey) || 0;

  if (attempts >= AUTH_RETRY_LIMIT) {
    authAttempts.delete(attemptKey);
    callback({ cancel: true });
    return;
  }

  authAttempts.set(attemptKey, attempts + 1);
  callback({
    authCredentials: {
      username: proxy.username,
      password: proxy.password || ""
    }
  });
}

function findProxyForChallenge(host, port) {
  const normalizedHost = String(host || "").toLowerCase();
  const normalizedPort = Number(port);

  return activeConfig.proxies.find((proxy) => {
    return proxy.host === normalizedHost && Number(proxy.port) === normalizedPort;
  });
}

function clearAuthAttempts(requestId) {
  const prefix = `${requestId}:`;
  for (const key of authAttempts.keys()) {
    if (key.startsWith(prefix)) {
      authAttempts.delete(key);
    }
  }
}
