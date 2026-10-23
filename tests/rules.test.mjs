import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { normalizeConfig, validateConfig, saveConfig, loadConfig, splitDomainPatterns, addDomainRule } from '../src/shared/config.js';
import { buildPacScript, findProxyForHost } from '../src/shared/pac.js';

const proxies = [
  { id: 'a', name: 'A', scheme: 'http', host: 'localhost', port: 8080 },
  { id: 'b', name: 'B', scheme: 'socks5', host: 'localhost', port: 1080 }
];
const rule = (patterns, extra = {}) => ({ id: 'r', patterns, comment: '工作 "服务"', proxyId: 'a', enabled: true, ...extra });
const config = (rules, extra = {}) => ({ enabled: true, proxies, rules, ...extra });

test('legacy migration and patterns precedence', () => {
  const legacy = normalizeConfig(config([{ id: 'old', pattern: 'Example.COM', proxyId: 'a' }]));
  assert.deepEqual(legacy.rules[0], { id: 'old', patterns: ['example.com'], comment: '', proxyId: 'a', enabled: true });
  const result = validateConfig(config([rule(['new.com'], { pattern: 'old.com' })]));
  assert.equal(result.ok, true);
  assert.deepEqual(result.config.rules[0].patterns, ['new.com']);
  assert.equal(validateConfig(config([rule([], { pattern: 'old.com' })])).ok, false);
});

test('split, normalize and deduplicate domains without discarding invalid entries', () => {
  assert.deepEqual(splitDomainPatterns('a.com, b.com，\nc.com\r\n,'), ['a.com', 'b.com', 'c.com']);
  const result = validateConfig(config([rule(['EXAMPLE.com', 'https://example.com/path', '*.Other.com'])]));
  assert.equal(result.ok, true);
  assert.deepEqual(result.config.rules[0].patterns, ['example.com', '*.other.com']);
  for (const patterns of [[], [''], ['valid.com', 'bad domain'], ['*'], [null]]) {
    assert.equal(validateConfig(config([rule(patterns)])).ok, false);
  }
  const invalid = validateConfig(config([rule(['valid.com', 'bad domain'])]));
  assert.ok(invalid.errors.some((error) => error.includes('第 1 条') && error.includes('bad domain')));
  assert.equal(validateConfig(config([rule(['a.com']), rule(['A.COM'], { id: 'r2' })])).ok, false);
  assert.equal(validateConfig(config([rule(['a.com'], { proxyId: 'missing' })])).ok, false);
});

test('export/import/save/load preserves domains and exact comment text', async () => {
  let stored = {};
  globalThis.chrome = { storage: { local: {
    get: async () => structuredClone(stored),
    set: async (value) => { stored = structuredClone(value); }
  } } };
  const source = config([rule(['a.com', '*.b.com'], { comment: ' 中文 "注释" <script> & \\  ' }), rule(['c.com'], { id: 'empty', comment: '' })]);
  const exported = JSON.stringify(normalizeConfig(validateConfig(source).config));
  const imported = validateConfig(JSON.parse(exported));
  assert.equal(imported.ok, true);
  await saveConfig(imported.config);
  assert.deepEqual(await loadConfig(), normalizeConfig(source));
  assert.equal(JSON.parse(exported).rules[1].comment, '');
  const before = structuredClone(stored);
  await assert.rejects(saveConfig(config([rule(['valid.com', '*'])])));
  assert.deepEqual(stored, before);
});

test('PAC and preview agree across grouped patterns and existing priority rules', () => {
  for (const globalProxyEnabled of [false, true]) {
    const source = normalizeConfig(config([
      rule(['example.com', 'other.com']),
      rule(['deep.example.com', '*.wild.com'], { id: 'b', proxyId: 'b' }),
      rule(['*.example.com'], { id: 'wild', proxyId: 'b' }),
      rule(['disabled.com'], { id: 'disabled', enabled: false })
    ], { globalProxyEnabled, globalProxyId: 'b' }));
    const script = buildPacScript(source);
    assert.ok(!script.includes(source.rules[0].comment));
    const context = vm.createContext({});
    vm.runInContext(script, context);
    const fallback = globalProxyEnabled ? 'SOCKS5 localhost:1080' : 'DIRECT';
    for (const [host, expected] of [
      ['example.com', 'PROXY localhost:8080'],
      ['X.EXAMPLE.COM', 'PROXY localhost:8080'],
      ['deep.example.com', 'SOCKS5 localhost:1080'],
      ['x.deep.example.com', 'SOCKS5 localhost:1080'],
      ['other.com', 'PROXY localhost:8080'],
      ['wild.com', 'SOCKS5 localhost:1080'],
      ['x.wild.com', 'SOCKS5 localhost:1080'],
      ['disabled.com', fallback], ['unknown.com', fallback], ['notexample.com', fallback]
    ]) {
      assert.equal(context.FindProxyForURL(`https://${host}`, host), expected, host);
      assert.equal(findProxyForHost(source, host)?.pacValue || 'DIRECT', expected, host);
    }
    const match = findProxyForHost(source, 'other.com');
    assert.equal(match.matchedPattern, 'other.com');
    assert.equal(match.rule, source.rules[0]);
  }
});

test('quick add splits only the requested domain and preserves other settings', () => {
  for (const enabled of [true, false]) {
    for (const proxyId of ['a', 'b']) {
      const source = config([rule(['a.com', 'b.com'], { enabled })]);
      addDomainRule(source, 'a.com', proxyId);
      if (enabled && proxyId === 'a') {
        assert.equal(source.rules.length, 1);
        assert.deepEqual(source.rules[0].patterns, ['a.com', 'b.com']);
      } else {
        assert.equal(source.rules.length, 2);
        assert.deepEqual(source.rules[0], rule(['b.com'], { enabled }));
        assert.deepEqual(source.rules[1].patterns, ['a.com']);
        assert.equal(source.rules[1].comment, source.rules[0].comment);
        assert.equal(source.rules[1].proxyId, proxyId);
        assert.equal(source.rules[1].enabled, true);
      }
      assert.equal(validateConfig(source).ok, true);
    }
  }
});

test('quick add updates a single-domain rule or creates a new rule', () => {
  const source = config([rule(['a.com'], { enabled: false })]);
  addDomainRule(source, 'a.com', 'b');
  assert.deepEqual(source.rules, [rule(['a.com'], { enabled: true, proxyId: 'b' })]);
  addDomainRule(source, 'new.com', 'a');
  assert.equal(source.rules.length, 2);
  assert.deepEqual(source.rules[1].patterns, ['new.com']);
  assert.equal(source.rules[1].comment, '');
});
