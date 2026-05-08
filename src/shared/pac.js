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

  config.rules
    .filter((rule) => rule.enabled && proxiesById.has(rule.proxyId))
    .forEach((rule) => {
      const proxy = formatPacProxy(proxiesById.get(rule.proxyId));
      if (rule.pattern.startsWith("*.")) {
        wildcardRules[rule.pattern.slice(2)] = proxy;
        return;
      }
      exactRules[rule.pattern] = proxy;
    });

  return `var EXACT_RULES = ${JSON.stringify(exactRules)};\nvar WILDCARD_RULES = ${JSON.stringify(wildcardRules)};\n\nfunction FindProxyForURL(url, host) {\n  var normalizedHost = String(host || "").toLowerCase();\n  var labels = normalizedHost.split(".");\n\n  for (var i = 0; i < labels.length; i += 1) {\n    var exactSuffix = labels.slice(i).join(".");\n    if (Object.prototype.hasOwnProperty.call(EXACT_RULES, exactSuffix)) {\n      return EXACT_RULES[exactSuffix];\n    }\n  }\n\n  for (var j = 0; j < labels.length; j += 1) {\n    var wildcardSuffix = labels.slice(j).join(".");\n    if (Object.prototype.hasOwnProperty.call(WILDCARD_RULES, wildcardSuffix)) {\n      return WILDCARD_RULES[wildcardSuffix];\n    }\n  }\n\n  return "DIRECT";\n}\n`;
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
    .sort((left, right) => getRuleScore(right.pattern) - getRuleScore(left.pattern));

  for (const rule of rules) {
    const exact = !rule.pattern.startsWith("*.");
    if (matchesHost(normalizedHost, rule.pattern, exact)) {
      return {
        rule,
        proxy: proxiesById.get(rule.proxyId),
        pacValue: formatPacProxy(proxiesById.get(rule.proxyId))
      };
    }
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
