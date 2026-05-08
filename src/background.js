import { loadConfig, normalizeProxy, STORAGE_KEY } from "./shared/config.js";
import { buildPacScript, formatPacProxy } from "./shared/pac.js";

const AUTH_RETRY_LIMIT = 2;
const PROXY_TEST_HOST = "api64.ipify.org";
const PROXY_TEST_URL = "https://api64.ipify.org?format=json";
const PROXY_TEST_TIMEOUT_MS = 8000;
const authAttempts = new Map();
let activeConfig = null;
let proxyTestInProgress = false;
let lastProxyError = null;

chrome.runtime.onInstalled.addListener(() => {
  applyStoredConfig();
});

chrome.runtime.onStartup.addListener(() => {
  applyStoredConfig();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]) {
    if (proxyTestInProgress) {
      return;
    }
    applyStoredConfig();
  }
});

chrome.proxy.onProxyError.addListener((details) => {
  lastProxyError = details;
  console.warn("Proxy error", details);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "test-proxy") {
    return false;
  }

  testProxy(message.proxy)
    .then((result) => {
      sendResponse({ ok: true, ...result });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error.message || "测试失败",
        proxyValue: error.proxyValue,
        proxyError: error.proxyError,
        targetHost: PROXY_TEST_HOST
      });
    });

  return true;
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
  try {
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
  } catch (error) {
    console.error("Failed to apply proxy config", error);
    updateBadge(false, "!");
  }
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

function updateBadge(enabled, text) {
  chrome.action.setBadgeText({ text: text ?? (enabled ? "ON" : "") });
  chrome.action.setBadgeBackgroundColor({ color: enabled ? "#1f8f5f" : "#b42318" });
}

async function testProxy(proxyInput) {
  if (proxyTestInProgress) {
    throw new Error("已有测试正在进行，请稍后再试。");
  }

  const proxy = normalizeProxy(proxyInput);
  if (!proxy) {
    throw new Error("代理配置无效，请检查 Host 和端口。");
  }

  proxyTestInProgress = true;
  const proxyValue = formatPacProxy(proxy);
  const testUrl = `${PROXY_TEST_URL}&mpr_cache=${encodeURIComponent(createTestToken())}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROXY_TEST_TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    lastProxyError = null;
    await applyProxyTestConfig(proxy);

    const response = await fetch(testUrl, {
      cache: "no-store",
      signal: controller.signal
    });
    const durationMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      throw new Error(`请求失败：HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data || typeof data.ip !== "string" || !data.ip) {
      throw new Error("响应中没有 IP 地址");
    }

    return {
      ip: data.ip,
      durationMs
    };
  } catch (error) {
    const testError = error.name === "AbortError" ? new Error("请求超时") : error;
    testError.proxyValue = proxyValue;
    testError.proxyError = lastProxyError ? formatProxyError(lastProxyError) : "";
    throw testError;
  } finally {
    clearTimeout(timeoutId);
    try {
      await applyStoredConfig();
    } finally {
      proxyTestInProgress = false;
    }
  }
}

async function applyProxyTestConfig(proxy) {
  const storedConfig = await loadConfig();
  const storedPacScript = storedConfig.enabled ? buildPacScript(storedConfig) : "";
  activeConfig = {
    ...storedConfig,
    enabled: true,
    proxies: upsertProxy(storedConfig.proxies, proxy)
  };

  await setProxyConfig({
    mode: "pac_script",
    pacScript: {
      data: buildProxyTestPacScript(proxy, storedConfig.enabled, storedPacScript),
      mandatory: false
    }
  });
  updateBadge(true, "T");
}

function buildProxyTestPacScript(proxy, shouldUseStoredPac, storedPacScript) {
  const proxyValue = formatPacProxy(proxy);
  const testHost = escapePacString(PROXY_TEST_HOST);
  const fallbackScript = shouldUseStoredPac ? renameStoredFindProxyForURL(storedPacScript) : "";
  const fallbackCall = shouldUseStoredPac ? "  return StoredFindProxyForURL(url, host);" : '  return "DIRECT";';

  return `${fallbackScript}\n\nfunction FindProxyForURL(url, host) {\n  if (String(host || "").toLowerCase() === "${testHost}") {\n    return "${escapePacString(proxyValue)}";\n  }\n\n${fallbackCall}\n}\n`;
}

function upsertProxy(proxies, proxy) {
  const withoutProxy = proxies.filter((item) => {
    const sameId = item.id === proxy.id;
    const sameEndpoint = item.host === proxy.host && Number(item.port) === Number(proxy.port);
    return !sameId && !sameEndpoint;
  });
  return [proxy, ...withoutProxy];
}

function createTestToken() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function renameStoredFindProxyForURL(script) {
  return script.replace("function FindProxyForURL", "function StoredFindProxyForURL");
}

function formatProxyError(details) {
  return [details.error, details.details].filter(Boolean).join("：");
}

function escapePacString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
