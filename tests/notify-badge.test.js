import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import zlib from "node:zlib";
import { NOTIFICATION_BADGE, NOTIFICATION_ICON, questTag } from "../src/notify.js";

function decodeRgbaPng(buf) {
  // PNG signature
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatParts = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + len;
  }
  assert.equal(bitDepth, 8);
  assert.equal(colorType, 6, "badge PNG must be RGBA (colorType 6)");

  const raw = zlib.inflateSync(Buffer.concat(idatParts));
  const stride = width * 4;
  const pixels = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
  };

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const val = raw[rowIn + x];
      const left = x >= 4 ? pixels[rowOut + x - 4] : 0;
      const up = y > 0 ? pixels[rowOut - stride + x] : 0;
      const upLeft = y > 0 && x >= 4 ? pixels[rowOut - stride + x - 4] : 0;
      let recon = val;
      if (filter === 1) recon = (val + left) & 0xff;
      else if (filter === 2) recon = (val + up) & 0xff;
      else if (filter === 3) recon = (val + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) recon = (val + paeth(left, up, upLeft)) & 0xff;
      pixels[rowOut + x] = recon;
    }
  }
  return { width, height, pixels };
}

test("badge-96.png is a 96x96 monochrome white-on-transparent PNG and all showNotification calls pass /ember/ icon + badge", () => {
  const badgeBuf = fs.readFileSync(new URL("../public/icons/badge-96.png", import.meta.url));
  const { width, height, pixels } = decodeRgbaPng(badgeBuf);
  assert.equal(width, 96);
  assert.equal(height, 96);

  let transparentPx = 0;
  let visibleWhitePx = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    if (a === 0) {
      transparentPx += 1;
    } else {
      assert.equal(r, 255, "non-transparent badge pixel must be pure white R=255");
      assert.equal(g, 255, "non-transparent badge pixel must be pure white G=255");
      assert.equal(b, 255, "non-transparent badge pixel must be pure white B=255");
      visibleWhitePx += 1;
    }
  }
  assert.ok(transparentPx > 4000, "background must be transparent");
  assert.ok(visibleWhitePx > 1000, "Ember silhouette must be drawn");

  // Paths respect /ember/ base and questTag dedupe stays unchanged
  assert.equal(NOTIFICATION_ICON, "/ember/icons/icon-192.png");
  assert.equal(NOTIFICATION_BADGE, "/ember/icons/badge-96.png");
  assert.equal(questTag("2026-11-14", "07:20", "Make your bed"), "quest:2026-11-14:07:20:Make your bed");

  // Verify every showNotification call in src/notify.js and public/sw.js passes both icon and badge
  for (const rel of ["../src/notify.js", "../public/sw.js"]) {
    const src = fs.readFileSync(new URL(rel, import.meta.url), "utf8");
    const matches = [...src.matchAll(/showNotification\([\s\S]*?\}\)/g)];
    assert.ok(matches.length >= 2, `${rel} should have showNotification calls`);
    for (const [block] of matches) {
      assert.match(block, /\bicon\s*:/, `${rel} showNotification missing icon`);
      assert.match(block, /\bbadge\s*:/, `${rel} showNotification missing badge`);
    }
  }
});
