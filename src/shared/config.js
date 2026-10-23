export const STORAGE_KEY = "multiProxyRouterConfig";

export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  globalProxyEnabled: false,
  globalProxyId: "",
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
  const globalProxyId = cleanText(source.globalProxyId);
  const hasGlobalProxy = knownProxyIds.has(globalProxyId);

  return {
    enabled: Boolean(source.enabled),
    globalProxyEnabled: Boolean(source.globalProxyEnabled) && hasGlobalProxy,
    globalProxyId: hasGlobalProxy ? globalProxyId : "",
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
  const { patterns, invalid } = parseRulePatterns(rule);
  const proxyId = cleanText(rule.proxyId);

  if (!patterns.length || invalid.length || !proxyId) {
    return null;
  }

  return {
    id,
    patterns,
    comment: typeof rule.comment === "string" ? rule.comment : "",
    proxyId,
    enabled: rule.enabled !== false
  };
}

// Keep invalid entries until validation so a typo cannot silently remove a domain.
export function splitDomainPatterns(value) {
  return value.split(/[\r\n,，]/).map((part) => part.trim()).filter(Boolean);
}

function parseRulePatterns(rule) {
  const value = Object.prototype.hasOwnProperty.call(rule, "patterns")
    ? rule.patterns
    : [rule.pattern];
  const entries = Array.isArray(value) ? value : [value];
  const patterns = [];
  const invalid = [];
  for (const entry of entries) {
    if (typeof entry !== "string") {
      invalid.push(String(entry));
      continue;
    }
    for (const item of splitDomainPatterns(entry)) {
      const pattern = normalizeDomainPattern(item);
      if (!pattern) invalid.push(item);
      else if (!patterns.includes(pattern)) patterns.push(pattern);
    }
  }
  return { patterns, invalid };
}

export function addDomainRule(config, pattern, proxyId) {
  const existing = config.rules.find((rule) => rule.patterns.includes(pattern));
  if (existing && existing.proxyId === proxyId && existing.enabled) return;
  if (existing && existing.patterns.length === 1) {
    existing.proxyId = proxyId;
    existing.enabled = true;
    return;
  }
  if (existing) existing.patterns = existing.patterns.filter((item) => item !== pattern);
  config.rules.push({
    id: createId("rule"),
    patterns: [pattern],
    comment: existing?.comment || "",
    proxyId,
    enabled: true
  });
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
  const rawGlobalProxyId = cleanText(source.globalProxyId);
  const rules = rawRules.map((rule, index) => {
    if (rule && typeof rule === "object") {
      const { invalid } = parseRulePatterns(rule);
      invalid.forEach((value) => errors.push(`第 ${index + 1} 条规则包含无效域名：${value}`));
    }
    const normalized = normalizeRule(rule);
    if (!normalized) {
      errors.push(`第 ${index + 1} 条规则缺少有效的域名或代理`);
      return null;
    }
    if (!knownProxyIds.has(normalized.proxyId)) {
      errors.push(`规则 ${normalized.patterns.join("、")} 指向不存在的代理`);
    }
    return normalized;
  });
  const normalized = {
    enabled: Boolean(source.enabled),
    globalProxyEnabled: Boolean(source.globalProxyEnabled) && knownProxyIds.has(rawGlobalProxyId),
    globalProxyId: knownProxyIds.has(rawGlobalProxyId) ? rawGlobalProxyId : "",
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

  if (source.globalProxyEnabled && !knownProxyIds.has(rawGlobalProxyId)) {
    errors.push("全局代理指向不存在的代理");
  }

  normalized.rules.forEach((rule) => {
    rule.patterns.forEach((pattern) => {
      if (rulePatterns.has(pattern)) errors.push(`规则重复：${pattern}`);
      rulePatterns.add(pattern);
    });
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
