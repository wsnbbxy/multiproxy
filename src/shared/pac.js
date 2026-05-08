const PAC_SCHEME = {
  http: "PROXY",
  https: "HTTPS",
  socks4: "SOCKS4",
  socks5: "SOCKS5"
};

export function buildPacScript(config) {
  const proxiesById = new Map(config.proxies.map((proxy) => [proxy.id, proxy]));
  const rules = config.rules
    .filter((rule) => rule.enabled && proxiesById.has(rule.proxyId))
    .map((rule) => {
      const proxy = proxiesById.get(rule.proxyId);
      return {
        pattern: rule.pattern,
        proxy: formatPacProxy(proxy),
        exact: !rule.pattern.startsWith("*."),
        score: getRuleScore(rule.pattern)
      };
    })
    .sort((left, right) => right.score - left.score);

  return `var RULES = ${JSON.stringify(rules)};\n\nfunction FindProxyForURL(url, host) {\n  var normalizedHost = String(host || "").toLowerCase();\n\n  for (var i = 0; i < RULES.length; i += 1) {\n    var rule = RULES[i];\n    if (matchesRule(normalizedHost, rule.pattern, rule.exact)) {\n      return rule.proxy;\n    }\n  }\n\n  return "DIRECT";\n}\n\nfunction matchesRule(host, pattern, exact) {\n  if (exact) {\n    return host === pattern || dnsDomainIs(host, "." + pattern);\n  }\n\n  var suffix = pattern.slice(2);\n  return dnsDomainIs(host, "." + suffix);\n}\n`;
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

  return host.endsWith(pattern.slice(1));
}
