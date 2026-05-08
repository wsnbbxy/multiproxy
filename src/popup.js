import { loadConfig, saveConfig } from "./shared/config.js";

let config = null;

const enabled = document.querySelector("#enabled");
const state = document.querySelector("#state");
const proxyCount = document.querySelector("#proxy-count");
const ruleCount = document.querySelector("#rule-count");
const status = document.querySelector("#status");

enabled.addEventListener("change", async () => {
  config.enabled = enabled.checked;
  await saveConfig(config);
  render();
  status.textContent = enabled.checked ? "代理已启用。" : "代理已关闭。";
});

document.querySelector("#open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

init();

async function init() {
  config = await loadConfig();
  render();
}

function render() {
  enabled.checked = config.enabled;
  state.textContent = config.enabled ? "当前按域名规则分流" : "当前所有流量直连";
  proxyCount.textContent = String(config.proxies.length);
  ruleCount.textContent = String(config.rules.length);
}
