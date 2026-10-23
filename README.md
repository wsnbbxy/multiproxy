# Multi Proxy Router

Chrome Manifest V3 extension for routing different domains through different proxies.

## Features

- Multiple HTTP, HTTPS, SOCKS4, and SOCKS5 proxy profiles
- Domain wildcard rules such as `github.com` and `*.google.com`
- PAC-script based routing with unmatched domains going `DIRECT`
- Proxy username/password support through `webRequest.onAuthRequired`
- Options page for full management
- Popup for quick enable/disable and status
- JSON import/export for backup

## Install Locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder: `/Users/xiayang/chrome_proxy`.

## Usage

1. Open the extension options page.
2. Add one or more proxies.
3. Add domain rules and choose which proxy each rule should use.
4. Enable the extension and click Save and apply.

Rules are matched by specificity. Exact domains, such as `github.com`, win over wildcard rules. Longer matching domain suffixes win over shorter ones.

## Notes

- Proxy passwords are stored in `chrome.storage.local` without extra encryption.
- Rules only match hostnames, not URL paths.
- Chrome may show permission warnings because the extension needs `proxy`, `webRequest`, and `<all_urls>` for proxy routing and authentication.

## Multiple domains and comments

Each rule row accepts multiple domains in a text area, separated by newlines,
English commas (`,`) or Chinese commas (`，`). All domains in a row share the
selected proxy and enabled switch. The optional comment identifies the whole
rule and is preserved when saving, exporting and importing JSON.

Rules use this JSON structure (the referenced proxy must exist in `proxies`):

```json
{
  "id": "rule-work",
  "patterns": ["github.com", "*.google.com"],
  "comment": "工作服务",
  "proxyId": "proxy-work",
  "enabled": true
}
```

Existing configurations with a single `pattern` are read as a one-item
`patterns` array; missing comments default to `""`. When both fields exist,
`patterns` takes precedence. Saving or exporting writes the new format,
including empty comments. Older extension versions may not read this format.
Invalid domains prevent saving/importing. Duplicates within a row are merged;
the same normalized domain in different rows is rejected.

The popup's “add current website” action splits an existing grouped rule when
needed to change only that domain's proxy or enable only that domain. The new
rule inherits the original comment, and the other domains retain their settings.

Run regression tests with Node.js 22.18+:

```sh
node --test tests/*.test.mjs
```
