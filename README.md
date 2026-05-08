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
