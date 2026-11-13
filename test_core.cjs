const assert = require('node:assert/strict');
const C = require('./core.js');
assert.deepEqual(C.characters('天 地\n天\ufeff𠀀'), ['天', '地', '天', '𠀀']);
assert.throws(() => C.characters(' \n'));
assert.throws(() => C.title('../test'));
assert.throws(() => C.parseJSON('{"title":"x","textUrl":"https://example.com"}'));
assert.equal(C.name('?'), 'U+3F.svg');
assert.ok(Math.abs(C.width(12, 0, 1) - 1.8) < 1e-10);
assert.equal(C.width(12, .2, 0), 12);
const strokes = [[{ x: 10, y: 20, width: 12 }]];
const p = { title: '稿紙', chars: ['天'], drafts: { 0: { strokes } } };
assert.equal(C.count(p, 'owner/repo@main'), 0);
p.drafts[0].uploaded = { title: p.title, signature: C.signature(strokes), destination: 'owner/repo@main' };
assert.equal(C.done(p, 0, 'owner/repo@main'), false, 'legacy SVG can be re-uploaded');
p.drafts[0].uploaded.svgFormat = C.svgFormat;
assert.equal(C.done(p, 0, 'owner/repo@main'), true);
assert.equal(C.count(p, 'owner/repo@main'), 0);
const roughStrokes = [[{ x: 30, y: 20, width: 8 }, { x: 150, y: 65, width: 12 }]];
p.drafts[0].roughStrokes = roughStrokes;
p.drafts[0].roughUploaded = {
  title: p.title,
  signature: C.signature(roughStrokes),
  destination: 'owner/repo@main',
  svgFormat: C.svgFormat,
};
assert.equal(C.count(p, 'owner/repo@main'), 1);
assert.equal(C.count(p, 'other/repo@main'), 0);
p.drafts[0].strokes = [];
assert.equal(C.count(p, 'owner/repo@main'), 0);

// The downloaded dot, short line and retraced stroke are closed ink outlines.
const shortStrokes = [[{ x: 20, y: 20, width: 2 }, { x: 21, y: 20, width: 3 }]];
const retracedStroke = [[
  { x: 20, y: 30, width: 4 },
  { x: 80, y: 30, width: 6 },
  { x: 20, y: 30, width: 4 },
]];
const exported = C.svg([...strokes, ...shortStrokes, ...retracedStroke]);
assert.match(exported, /viewBox="0 0 300 300"/);
assert.doesNotMatch(exported, /<circle|stroke-width|NaN|Infinity/);
const paths = [...exported.matchAll(/<path d="([^"]+)" fill="black" fill-rule="nonzero"\/>/g)];
assert.equal(paths.length, 3);
for (const [, path] of paths) {
  assert.match(path, /^M .* Z$/);
}
assert.match(paths[2][1], / Z M /, 'a reversal retains filled ink on both sides');
assert.match(C.svg(strokes), /M 292 150 .*L 8 150/, 'dot is centered and retains its diameter');
assert.throws(() => C.svg([[]]), /請先寫字/);
const m = {
  actualBoundingBoxLeft: 3,
  actualBoundingBoxRight: 83,
  actualBoundingBoxAscent: 77,
  actualBoundingBoxDescent: 13
};
const fit = C.fitBounds(m, 1000);
const left = (fit.x - m.actualBoundingBoxLeft) * fit.scale + 500;
const right = (fit.x + m.actualBoundingBoxRight) * fit.scale + 500;
const top = (fit.y - m.actualBoundingBoxAscent) * fit.scale + 500;
const bottom = (fit.y + m.actualBoundingBoxDescent) * fit.scale + 500;
assert.ok(Math.abs((left + right) / 2 - 500) < 1e-8);
assert.ok(Math.abs((top + bottom) / 2 - 500) < 1e-8);
assert.ok(Math.abs(Math.max(right - left, bottom - top) - 850) < 1e-8);
console.log('PASS: prompt import, duplicate characters, pressure, upload completion/destination, guide center and 85% bounds.');
