import { addDomainRule, loadConfig, normalizeDomainPattern, saveConfig } from "./shared/config.js";

let config = null;
let isSaving = false;

const enabled = document.querySelector("#enabled");
const state = document.querySelector("#state");
const proxyCount = document.querySelector("#proxy-count");
const ruleCount = document.querySelector("#rule-count");
const status = document.querySelector("#status");
const proxySelect = document.querySelector("#proxy-select");
const addCurrent = document.querySelector("#add-current");
const globalProxyEnabled = document.querySelector("#global-proxy-enabled");
const globalProxyState = document.querySelector("#global-proxy-state");

enabled.addEventListener("change", async () => {
  const nextEnabled = enabled.checked;
  if (!beginSave()) {
    return;
  }

  try {
    const nextConfig = structuredClone(config);
    nextConfig.enabled = nextEnabled;
    config = await saveConfig(nextConfig);
    status.textContent = nextEnabled ? "代理已启用。" : "代理已关闭。";
  } catch (error) {
    status.textContent = `保存失败：${error.message}`;
  } finally {
    finishSave();
  }
});

globalProxyEnabled.addEventListener("change", async () => {
  const nextEnabled = globalProxyEnabled.checked;
  if (!beginSave()) {
    return;
  }

  try {
    if (!getGlobalProxy()) {
      throw new Error("请先在选项页选择全局代理。");
    }
    const nextConfig = structuredClone(config);
    nextConfig.globalProxyEnabled = nextEnabled;
    config = await saveConfig(nextConfig);
    status.textContent = nextEnabled ? "全局代理已启用。" : "全局代理已关闭。";
  } catch (error) {
    status.textContent = `保存失败：${error.message}`;
  } finally {
    finishSave();
  }
});

document.querySelector("#open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

addCurrent.addEventListener("click", async () => {
  if (!beginSave()) {
    return;
  }

  const proxyId = proxySelect.value;
  try {
    if (!config.proxies.some((proxy) => proxy.id === proxyId)) {
      throw new Error("请先添加一个代理。");
    }
    const nextConfig = structuredClone(config);
    const pattern = await getCurrentTabPattern();
    addDomainRule(nextConfig, pattern, proxyId);

    config = await saveConfig(nextConfig);
    status.textContent = `已添加规则 ${pattern}。`;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    finishSave();
  }
});

updateControlAvailability();
init();

function beginSave() {
  if (!config) {
    status.textContent = "配置尚未加载完成。";
    updateControlAvailability();
    return false;
  }
  if (isSaving) {
    render();
    return false;
  }
  isSaving = true;
  updateControlAvailability();
  return true;
}

function finishSave() {
  isSaving = false;
  render();
}

function updateControlAvailability() {
  const busy = !config || isSaving;
  const hasProxies = Boolean(config?.proxies.length);
  enabled.disabled = busy;
  globalProxyEnabled.disabled = busy || !getGlobalProxy();
  proxySelect.disabled = busy || !hasProxies;
  addCurrent.disabled = busy || !hasProxies;
}

async function init() {
  try {
    config = await loadConfig();
    render();
  } catch (error) {
    status.textContent = `加载失败：${error.message}`;
  }
}

function render() {
  enabled.checked = config.enabled;
  const globalProxy = getGlobalProxy();
  state.textContent = getStateText(globalProxy);
  proxyCount.textContent = String(config.proxies.length);
  ruleCount.textContent = String(config.rules.length);
  globalProxyEnabled.checked = Boolean(config.globalProxyEnabled && globalProxy);
  globalProxyState.textContent = globalProxy
    ? `全局代理：${globalProxy.name}`
    : "全局代理未配置";
  renderProxyOptions();
  updateControlAvailability();
}

function renderProxyOptions() {
  const previousValue = proxySelect.value;
  proxySelect.textContent = "";

  config.proxies.forEach((proxy) => {
    const option = document.createElement("option");
    option.value = proxy.id;
    option.textContent = proxy.name || `${proxy.scheme}://${proxy.host}:${proxy.port}`;
    proxySelect.append(option);
  });

  proxySelect.value = config.proxies.some((proxy) => proxy.id === previousValue)
    ? previousValue
    : config.proxies[0]?.id || "";
}

async function getCurrentTabPattern() {
  const tabs = await queryActiveTabs();
  const tab = tabs[0];

  if (!tab?.url) {
    throw new Error("无法读取当前网页地址。");
  }

  let url;
  try {
    url = new URL(tab.url);
  } catch (error) {
    throw new Error("当前网页地址无效，无法添加规则。");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("只能添加 http 或 https 网页。");
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!hostname || isIpAddress(hostname)) {
    throw new Error("当前网页域名无法生成通配规则。");
  }

  const pattern = normalizeDomainPattern(`*.${hostname}`);
  if (!pattern) {
    throw new Error("当前网页域名无法生成通配规则。");
  }

  return pattern;
}

function queryActiveTabs() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tabs);
    });
  });
}

function isIpAddress(hostname) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

function getGlobalProxy() {
  return config?.proxies.find((proxy) => proxy.id === config.globalProxyId);
}

function getStateText(globalProxy) {
  if (!config.enabled) {
    return "当前所有流量直连";
  }
  if (config.globalProxyEnabled && globalProxy) {
    return "当前按规则分流，未命中走全局代理";
  }
  return "当前按域名规则分流";
}
