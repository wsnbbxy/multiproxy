const PAC_SCHEME = {
  http: "PROXY",
  https: "HTTPS",
  socks4: "SOCKS4",
  socks5: "SOCKS5"
};

export function buildPacScript(config) {
  const proxiesById = new Map(config.proxies.map((proxy) => [proxy.id, proxy]));
  const exactRules = {};
  const wildcardRules = {};
  const globalProxy =
    config.globalProxyEnabled && proxiesById.has(config.globalProxyId)
      ? formatPacProxy(proxiesById.get(config.globalProxyId))
      : "DIRECT";

  config.rules
    .filter((rule) => rule.enabled && proxiesById.has(rule.proxyId))
    .forEach((rule) => {
      const proxy = formatPacProxy(proxiesById.get(rule.proxyId));
      rule.patterns.forEach((pattern) => {
        if (pattern.startsWith("*.")) wildcardRules[pattern.slice(2)] = proxy;
        else exactRules[pattern] = proxy;
      });
    });

  return `var EXACT_RULES = ${JSON.stringify(exactRules)};\nvar WILDCARD_RULES = ${JSON.stringify(wildcardRules)};\nvar GLOBAL_PROXY = ${JSON.stringify(globalProxy)};\n\nfunction FindProxyForURL(url, host) {\n  var normalizedHost = String(host || "").toLowerCase();\n  var labels = normalizedHost.split(".");\n\n  for (var i = 0; i < labels.length; i += 1) {\n    var exactSuffix = labels.slice(i).join(".");\n    if (Object.prototype.hasOwnProperty.call(EXACT_RULES, exactSuffix)) {\n      return EXACT_RULES[exactSuffix];\n    }\n  }\n\n  for (var j = 0; j < labels.length; j += 1) {\n    var wildcardSuffix = labels.slice(j).join(".");\n    if (Object.prototype.hasOwnProperty.call(WILDCARD_RULES, wildcardSuffix)) {\n      return WILDCARD_RULES[wildcardSuffix];\n    }\n  }\n\n  return GLOBAL_PROXY;\n}\n`;
}

export function formatPacProxy(proxy) {
  const scheme = PAC_SCHEME[proxy.scheme] || "PROXY";
  return `${scheme} ${proxy.host}:${proxy.port}`;
}

export function getRuleScore(pattern) {
  const exactBonus = pattern.startsWith("*.") ? 0 : 10000;
  return exactBonus + pattern.replace(/^\*\./, "").length;
}

export function findProxyForHost(config, host) {
  const normalizedHost = String(host || "").trim().toLowerCase();
  const proxiesById = new Map(config.proxies.map((proxy) => [proxy.id, proxy]));
  const rules = config.rules
    .filter((rule) => rule.enabled && proxiesById.has(rule.proxyId))
    .flatMap((rule) => rule.patterns.map((pattern) => ({ rule, pattern })))
    .sort((left, right) => getRuleScore(right.pattern) - getRuleScore(left.pattern));

  for (const { rule, pattern } of rules) {
    const exact = !pattern.startsWith("*.");
    if (matchesHost(normalizedHost, pattern, exact)) {
      return {
        rule,
        matchedPattern: pattern,
        proxy: proxiesById.get(rule.proxyId),
        pacValue: formatPacProxy(proxiesById.get(rule.proxyId))
      };
    }
  }

  if (config.globalProxyEnabled && proxiesById.has(config.globalProxyId)) {
    const proxy = proxiesById.get(config.globalProxyId);
    return {
      rule: null,
      proxy,
      pacValue: formatPacProxy(proxy),
      global: true
    };
  }

  return null;
}

function matchesHost(host, pattern, exact) {
  if (exact) {
    return host === pattern || host.endsWith(`.${pattern}`);
  }

  const suffix = pattern.slice(2);
  return host === suffix || host.endsWith(`.${suffix}`);
}
