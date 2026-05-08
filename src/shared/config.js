export const STORAGE_KEY = "multiProxyRouterConfig";

export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  proxies: [],
  rules: []
});

export const PROXY_SCHEMES = ["http", "https", "socks4", "socks5"];

export function createId(prefix) {
  const random =
    globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export function normalizeConfig(input) {
  const source = input && typeof input === "object" ? input : {};
  const proxies = Array.isArray(source.proxies)
    ? source.proxies.map(normalizeProxy).filter(Boolean)
    : [];
  const knownProxyIds = new Set(proxies.map((proxy) => proxy.id));
  const rules = Array.isArray(source.rules)
    ? source.rules
        .map((rule) => normalizeRule(rule))
        .filter((rule) => rule && knownProxyIds.has(rule.proxyId))
    : [];

  return {
    enabled: Boolean(source.enabled),
    proxies,
    rules
  };
}

export function normalizeProxy(proxy) {
  if (!proxy || typeof proxy !== "object") {
    return null;
  }

  const id = cleanText(proxy.id) || createId("proxy");
  const name = cleanText(proxy.name) || "未命名代理";
  const scheme = PROXY_SCHEMES.includes(proxy.scheme) ? proxy.scheme : "http";
  const host = cleanHost(proxy.host);
  const port = Number.parseInt(proxy.port, 10);

  if (!isValidDomain(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return {
    id,
    name,
    scheme,
    host,
    port,
    username: cleanText(proxy.username),
    password: typeof proxy.password === "string" ? proxy.password : ""
  };
}

export function normalizeRule(rule) {
  if (!rule || typeof rule !== "object") {
    return null;
  }

  const id = cleanText(rule.id) || createId("rule");
  const pattern = normalizeDomainPattern(rule.pattern);
  const proxyId = cleanText(rule.proxyId);

  if (!pattern || !proxyId) {
    return null;
  }

  return {
    id,
    pattern,
    proxyId,
    enabled: rule.enabled !== false
  };
}

export function normalizeDomainPattern(value) {
  const pattern = cleanText(value).toLowerCase();
  if (!pattern) {
    return "";
  }

  const withoutScheme = pattern.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const withoutPath = withoutScheme.split(/[/?#]/)[0];
  const trimmed = withoutPath.replace(/^\.+|\.+$/g, "");

  if (!trimmed || trimmed === "*") {
    return "";
  }

  if (trimmed.startsWith("*.")) {
    const suffix = trimmed.slice(2);
    return isValidDomain(suffix) ? `*.${suffix}` : "";
  }

  return isValidDomain(trimmed) ? trimmed : "";
}

export function validateConfig(config) {
  const errors = [];
  const source = config && typeof config === "object" ? config : {};
  const rawProxies = Array.isArray(source.proxies) ? source.proxies : [];
  const rawRules = Array.isArray(source.rules) ? source.rules : [];
  const proxies = rawProxies.map((proxy, index) => {
    const normalized = normalizeProxy(proxy);
    if (!normalized) {
      errors.push(`第 ${index + 1} 个代理缺少有效的 host 或端口`);
    }
    return normalized;
  });
  const knownProxyIds = new Set(proxies.filter(Boolean).map((proxy) => proxy.id));
  const rules = rawRules.map((rule, index) => {
    const normalized = normalizeRule(rule);
    if (!normalized) {
      errors.push(`第 ${index + 1} 条规则缺少有效的域名或代理`);
      return null;
    }
    if (!knownProxyIds.has(normalized.proxyId)) {
      errors.push(`规则 ${normalized.pattern} 指向不存在的代理`);
    }
    return normalized;
  });
  const normalized = {
    enabled: Boolean(source.enabled),
    proxies: proxies.filter(Boolean),
    rules: rules.filter(Boolean)
  };
  const proxyIds = new Set();
  const rulePatterns = new Set();

  normalized.proxies.forEach((proxy) => {
    if (proxyIds.has(proxy.id)) {
      errors.push(`代理 ID 重复：${proxy.id}`);
    }
    proxyIds.add(proxy.id);
  });

  normalized.rules.forEach((rule) => {
    const key = rule.pattern.toLowerCase();
    if (rulePatterns.has(key)) {
      errors.push(`规则重复：${rule.pattern}`);
    }
    rulePatterns.add(key);
  });

  return {
    ok: errors.length === 0,
    errors,
    config: normalized
  };
}

export async function loadConfig() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeConfig(result[STORAGE_KEY]);
}

export async function saveConfig(config) {
  const validation = validateConfig(config);
  if (!validation.ok) {
    throw new Error(validation.errors.join("\n"));
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: validation.config });
  return validation.config;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanHost(value) {
  return cleanText(value)
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split(/[/:?#]/)[0]
    .toLowerCase();
}

function isValidDomain(value) {
  if (value.length > 253 || value.includes("..")) {
    return false;
  }
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(value);
}
