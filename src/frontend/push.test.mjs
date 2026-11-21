import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationServerKey, pushSupport } from "./push.ts";

const browser = { userAgent: "", standalone: false, serviceWorker: true, pushManager: true, notification: true };
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

test("push support by device", () => {
  assert.equal(pushSupport({ ...browser, userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/140" }), "supported");
  // iPhone and iPad (iPadOS reports a Mac with touch) only from the home screen app.
  assert.equal(pushSupport({ ...browser, userAgent: iphone }), "install");
  assert.equal(pushSupport({ ...browser, userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 }), "install");
  assert.equal(pushSupport({ ...browser, userAgent: iphone, standalone: true }), "supported");
  assert.equal(pushSupport({ ...browser, userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", pushManager: false }), "unsupported");
});

test("the VAPID key becomes the bytes the Push API wants", () => {
  assert.deepEqual([...applicationServerKey("BAEC_-8")], [4, 1, 2, 255, 239]);
});
