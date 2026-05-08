import { loadConfig, saveConfig } from "./shared/config.js";

let config = null;

const enabled = document.querySelector("#enabled");
const state = document.querySelector("#state");
const proxyCount = document.querySelector("#proxy-count");
const ruleCount = document.querySelector("#rule-count");
const status = document.querySelector("#status");

enabled.addEventListener("change", async () => {
  if (!config) {
    enabled.checked = false;
    status.textContent = "配置尚未加载完成。";
    return;
  }

  const nextEnabled = enabled.checked;
  enabled.disabled = true;
  config.enabled = enabled.checked;
  try {
    await saveConfig(config);
    render();
    status.textContent = nextEnabled ? "代理已启用。" : "代理已关闭。";
  } catch (error) {
    config.enabled = !nextEnabled;
    render();
    status.textContent = `保存失败：${error.message}`;
  } finally {
    enabled.disabled = false;
  }
});

document.querySelector("#open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

init();

async function init() {
  try {
    config = await loadConfig();
    render();
    enabled.disabled = false;
  } catch (error) {
    status.textContent = `加载失败：${error.message}`;
  }
}

function render() {
  enabled.checked = config.enabled;
  state.textContent = config.enabled ? "当前按域名规则分流" : "当前所有流量直连";
  proxyCount.textContent = String(config.proxies.length);
  ruleCount.textContent = String(config.rules.length);
}
