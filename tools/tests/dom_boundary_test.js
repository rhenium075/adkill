'use strict';
// Dependency-free regression for the exact predicates. jsdom/E2E cover real DOM behavior.
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
let output;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../adkill.js'), 'utf8'), {
  $request: { url: 'https://trafficnews.jp/' },
  $response: { body: '<html><head></head><body></body></html>', headers: { 'content-type': 'text/html' } },
  $done: r => output = r,
});
const injected = output.body.match(/<script id="__adkill_js">([\s\S]*?)<\/script>/)[1];
function run({ src = '', className = '', text = '', form = false, tagName = 'DIV', editable = false }) {
  const callbacks = {};
  const element = { tagName, className, id: '', innerText: text, isConnected: true,
    getAttribute: n => n === 'src' ? src : null,
    matches: () => editable || /^(FORM|INPUT|TEXTAREA|SELECT|BUTTON)$/.test(tagName),
    querySelector: selector => form && selector.includes('form,') ? {} : null,
    remove() { this.isConnected = false; },
  };
  const root = () => ({ style: { setProperty() {} }, classList: { remove() {} }, setAttribute() {}, querySelectorAll: () => [] });
  const document = { body: root(), documentElement: root(), addEventListener: (n, f) => { callbacks[n] = f; }, querySelectorAll: selector => selector === 'iframe' ? (src ? [element] : []) : (src ? [] : [element]) };
  const timer = () => 1;
  const window = { addEventListener() {}, setTimeout: timer };
  vm.runInNewContext(injected, { window, document, URL, location: { hostname: 'trafficnews.jp', href: 'https://trafficnews.jp/', hash: '' }, getComputedStyle: () => ({ position: 'fixed' }), setInterval() {}, setTimeout() {}, clearInterval() {}, MutationObserver: class { observe() {} } });
  callbacks.DOMContentLoaded();
  assert.equal(window.setTimeout, timer);
  return element.isConnected;
}
for (const src of ['https://video.example/embed?help=error-report.com', 'https://error-report.com.other.example/modal', 'https://video.example/modal?eventId=1', 'https://report.error-report.com/help']) assert.ok(run({ src }), src);
assert.equal(run({ src: 'https://report.error-report.com/modal?eventId=1' }), false);
assert.ok(run({ className: 'settings-modal', text: '広告ブロックの表示設定を保存します' }));
assert.ok(run({ className: 'adblock-settings', text: '広告ブロックの設定', form: true }));
assert.equal(run({ className: 'adblock-notice', text: '広告ブロッカーを無効にしてください' }), false);
assert.ok(run({ tagName: 'ARTICLE', className: 'adblock-notice', text: '広告ブロックの解説' }));
console.log('DOM URL boundaries, ordinary dialogs and original timer preservation: OK');

for (const tagName of ['FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']) assert.ok(run({ tagName, className: 'adblock-settings', text: '広告ブロックの設定' }), tagName);
assert.ok(run({ editable: true, className: 'adblock-settings', text: '広告ブロックの設定' }));
