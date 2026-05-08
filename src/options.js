import {
  createId,
  DEFAULT_CONFIG,
  loadConfig,
  normalizeConfig,
  normalizeDomainPattern,
  normalizeProxy,
  saveConfig,
  validateConfig
} from "./shared/config.js";
import { findProxyForHost } from "./shared/pac.js";

const state = {
  config: structuredClone(DEFAULT_CONFIG)
};

const elements = {
  enabled: document.querySelector("#enabled"),
  summary: document.querySelector("#summary"),
  proxyList: document.querySelector("#proxy-list"),
  ruleList: document.querySelector("#rule-list"),
  status: document.querySelector("#status"),
  configJson: document.querySelector("#config-json"),
  testHost: document.querySelector("#test-host"),
  testResult: document.querySelector("#test-result"),
  proxyTemplate: document.querySelector("#proxy-row-template"),
  ruleTemplate: document.querySelector("#rule-row-template")
};

document.querySelector("#add-proxy").addEventListener("click", () => {
  state.config.proxies.push({
    id: createId("proxy"),
    name: "",
    scheme: "http",
    host: "",
    port: 7890,
    username: "",
    password: ""
  });
  render();
});

document.querySelector("#add-rule").addEventListener("click", () => {
  state.config.rules.push({
    id: createId("rule"),
    pattern: "",
    proxyId: state.config.proxies[0]?.id || "",
    enabled: true
  });
  render();
});

document.querySelector("#save").addEventListener("click", async () => {
  syncFromDom();
  const validation = validateConfig(state.config);

  if (!validation.ok) {
    showStatus(validation.errors.join("；"), "error");
    return;
  }

  try {
    await saveConfig(validation.config);
    state.config = validation.config;
    render();
    showStatus("已保存并应用。", "success");
  } catch (error) {
    showStatus(`保存失败：${error.message}`, "error");
  }
});

document.querySelector("#export-config").addEventListener("click", () => {
  syncFromDom();
  const validation = validateConfig(state.config);
  if (!validation.ok) {
    showStatus(validation.errors.join("；"), "error");
    return;
  }
  elements.configJson.value = JSON.stringify(normalizeConfig(validation.config), null, 2);
  showStatus("配置已导出到文本框。", "success");
});

document.querySelector("#import-config").addEventListener("click", () => {
  try {
    const parsed = JSON.parse(elements.configJson.value);
    const validation = validateConfig(parsed);
    if (!validation.ok) {
      showStatus(validation.errors.join("；"), "error");
      return;
    }
    state.config = validation.config;
    render();
    showStatus("已导入，点击保存后生效。", "success");
  } catch (error) {
    showStatus(`JSON 无法解析：${error.message}`, "error");
  }
});

document.querySelector("#test-rule").addEventListener("click", () => {
  syncFromDom();
  const host = elements.testHost.value.trim();
  const validation = validateConfig(state.config);

  if (!host) {
    elements.testResult.textContent = "请输入要测试的域名。";
    return;
  }

  if (!validation.ok) {
    elements.testResult.textContent = `当前配置还不能测试：${validation.errors.join("；")}`;
    return;
  }

  const match = findProxyForHost(validation.config, host);
  if (!match) {
    elements.testResult.textContent = `${host} 未命中规则，将直连 DIRECT。`;
    return;
  }

  elements.testResult.textContent = `${host} 命中 ${match.rule.pattern}，使用 ${match.proxy.name} (${match.pacValue})。`;
});

elements.enabled.addEventListener("change", () => {
  state.config.enabled = elements.enabled.checked;
  updateSummary();
});

init();

async function init() {
  try {
    state.config = await loadConfig();
    render();
  } catch (error) {
    showStatus(`加载配置失败：${error.message}`, "error");
  }
}

function render() {
  elements.enabled.checked = state.config.enabled;
  renderProxies();
  renderRules();
  updateSummary();
}

function renderProxies() {
  elements.proxyList.textContent = "";

  state.config.proxies.forEach((proxy) => {
    const row = elements.proxyTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.id = proxy.id;
    setValue(row, "name", proxy.name);
    setValue(row, "scheme", proxy.scheme);
    setValue(row, "host", proxy.host);
    setValue(row, "port", proxy.port);
    setValue(row, "username", proxy.username);
    setValue(row, "password", proxy.password);
    row.querySelector('[data-action="test-proxy"]').addEventListener("click", () => {
      testProxyRow(proxy.id);
    });
    row.querySelector('[data-action="delete-proxy"]').addEventListener("click", () => {
      state.config.proxies = state.config.proxies.filter((item) => item.id !== proxy.id);
      state.config.rules = state.config.rules.filter((rule) => rule.proxyId !== proxy.id);
      render();
    });
    elements.proxyList.append(row);
  });
}

function renderRules() {
  elements.ruleList.textContent = "";

  state.config.rules.forEach((rule) => {
    const row = elements.ruleTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.id = rule.id;
    setChecked(row, "enabled", rule.enabled);
    setValue(row, "pattern", rule.pattern);

    const proxySelect = row.querySelector('[data-field="proxyId"]');
    state.config.proxies.forEach((proxy) => {
      const option = document.createElement("option");
      option.value = proxy.id;
      option.textContent = proxy.name || `${proxy.scheme}://${proxy.host}:${proxy.port}`;
      proxySelect.append(option);
    });
    proxySelect.value = rule.proxyId;

    row.querySelector('[data-action="delete-rule"]').addEventListener("click", () => {
      state.config.rules = state.config.rules.filter((item) => item.id !== rule.id);
      render();
    });
    elements.ruleList.append(row);
  });
}

function syncFromDom() {
  state.config.enabled = elements.enabled.checked;
  state.config.proxies = Array.from(elements.proxyList.querySelectorAll("tr")).map((row) => ({
    id: row.dataset.id,
    name: getValue(row, "name"),
    scheme: getValue(row, "scheme"),
    host: getValue(row, "host"),
    port: Number(getValue(row, "port")),
    username: getValue(row, "username"),
    password: getValue(row, "password")
  }));
  state.config.rules = Array.from(elements.ruleList.querySelectorAll("tr")).map((row) => ({
    id: row.dataset.id,
    enabled: getChecked(row, "enabled"),
    pattern: normalizeDomainPattern(getValue(row, "pattern")),
    proxyId: getValue(row, "proxyId")
  }));
}

function updateSummary() {
  const enabledText = state.config.enabled ? "已启用" : "未启用";
  elements.summary.textContent = `${enabledText}，${state.config.proxies.length} 个代理，${state.config.rules.length} 条规则。`;
}

function showStatus(message, type) {
  elements.status.textContent = message;
  elements.status.className = type || "";
}

function setValue(root, field, value) {
  root.querySelector(`[data-field="${field}"]`).value = value ?? "";
}

function setChecked(root, field, value) {
  root.querySelector(`[data-field="${field}"]`).checked = Boolean(value);
}

function getValue(root, field) {
  return root.querySelector(`[data-field="${field}"]`).value.trim();
}

function getChecked(root, field) {
  return root.querySelector(`[data-field="${field}"]`).checked;
}

async function testProxyRow(proxyId) {
  syncFromDom();
  const proxy = state.config.proxies.find((item) => item.id === proxyId);
  const row = elements.proxyList.querySelector(`tr[data-id="${CSS.escape(proxyId)}"]`);
  const result = row?.querySelector('[data-field="testResult"]');
  const button = row?.querySelector('[data-action="test-proxy"]');

  if (!proxy || !result || !button) {
    return;
  }

  if (!normalizeProxy(proxy)) {
    setProxyTestResult(result, "当前代理配置无效，请检查 Host 和端口。", "error");
    return;
  }

  button.disabled = true;
  setProxyTestButtonsDisabled(true);
  setProxyTestResult(result, "正在通过此代理获取外部 IP...", "");

  try {
    const response = await sendMessage({ type: "test-proxy", proxy });
    if (!response?.ok) {
      throw new Error(response?.error || "测试失败");
    }
    setProxyTestResult(
      result,
      `代理出口 ${response.ip}，响应 ${response.durationMs} ms。`,
      "success"
    );
  } catch (error) {
    setProxyTestResult(result, `测试失败：${error.message}`, "error");
  } finally {
    setProxyTestButtonsDisabled(false);
  }
}

function setProxyTestResult(element, message, type) {
  element.textContent = message;
  element.className = type || "";
}

function setProxyTestButtonsDisabled(disabled) {
  elements.proxyList.querySelectorAll('[data-action="test-proxy"]').forEach((button) => {
    button.disabled = disabled;
  });
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}
