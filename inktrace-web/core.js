(function (root) {
  'use strict';

  const SVG_FORMAT = 'filled-outline-v1';
  const SIMPLIFY_DISTANCE = 2;
  const SMOOTH_RADIUS = 2;
  const CAP_SEGMENTS = 8;

  function title(value) {
    const s = String(value || '').trim();
    if (!s || s.length > 80 || /[\/\\%?#\x00-\x1f\x7f-\x9f]/.test(s) || s.includes('..')) {
      throw Error('名稱限 1–80 字，不能包含 / \\ % ? # 或 ..。');
    }
    return s;
  }

  function characters(text) {
    const chars = [...text.replace(/^\uFEFF/, '')].filter(c => !/[\s\uFEFF]/u.test(c));
    if (!chars.length || chars.length > 4096) {
      throw Error('每份稿紙限 1–4096 字。');
    }
    if (chars.some(c => /[\x00-\x1f\x7f-\x9f\uD800-\uDFFF]/u.test(c))) {
      throw Error('內容含有不支援的控制字元。');
    }
    return chars;
  }

  function paper(name, text) {
    return {
      id: crypto.randomUUID(),
      title: title(name),
      chars: characters(text),
      drafts: {},
      selected: 0,
      createdAt: Date.now()
    };
  }

  function name(char) {
    return (/[\/\\%?#.]/.test(char) ? 'U+' + char.codePointAt(0).toString(16).toUpperCase() : char) + '.svg';
  }

  function signature(strokes) {
    return JSON.stringify(strokes || []);
  }
  const boardFields = {
    regular: { strokes: 'strokes', upload: 'uploaded' },
    rough: { strokes: 'roughStrokes', upload: 'roughUploaded' },
  };

  function done(p, index, destination, side = 'regular') {
    const draft = p.drafts[index];
    const fields = boardFields[side];
    const upload = draft?.[fields.upload];
    return Boolean(upload && upload.svgFormat === SVG_FORMAT &&
      upload.signature === signature(draft[fields.strokes]) &&
      upload.title === p.title && upload.destination === destination);
  }

  function pairDone(p, index, destination) {
    return done(p, index, destination) && done(p, index, destination, 'rough');
  }

  function count(p, dest) {
    return p.chars.reduce((n, _, i) => n + Number(pairDone(p, i, dest)), 0);
  }

  function prepareStroke(stroke) {
    const samples = [stroke[0]];
    for (let index = 1; index < stroke.length; index++) {
      const point = stroke[index];
      const last = samples.at(-1);
      const distance = Math.hypot(point.x - last.x, point.y - last.y);
      if (distance === 0) {
        // A stationary sample can still change the pressure of a dot.
        samples[samples.length - 1] = point;
      } else if (distance >= SIMPLIFY_DISTANCE || index === stroke.length - 1) {
        samples.push(point);
      }
    }

    // Keep the original endpoints. A short mark needs both to remain visible.
    return samples.map((point, index) => {
      const radius = Math.min(SMOOTH_RADIUS, index, samples.length - 1 - index);
      if (radius === 0) {
        return point;
      }
      const sum = { x: 0, y: 0, width: 0 };
      for (let neighbor = index - radius; neighbor <= index + radius; neighbor++) {
        sum.x += samples[neighbor].x;
        sum.y += samples[neighbor].y;
        sum.width += samples[neighbor].width;
      }
      const count = radius * 2 + 1;
      return { x: sum.x / count, y: sum.y / count, width: sum.width / count };
    });
  }

  function offsetPoint(point, angle) {
    const radius = point.width / 2;
    return { x: point.x + Math.cos(angle) * radius, y: point.y + Math.sin(angle) * radius };
  }

  function roundCap(point, startAngle) {
    return Array.from({ length: CAP_SEGMENTS - 1 }, (_, index) =>
      offsetPoint(point, startAngle - Math.PI * (index + 1) / CAP_SEGMENTS)
    );
  }

  function buildContour(points) {
    if (points.length === 1) {
      const segments = CAP_SEGMENTS * 2;
      return Array.from({ length: segments }, (_, index) =>
        offsetPoint(points[0], -2 * Math.PI * index / segments)
      );
    }

    const left = [];
    const right = [];
    const angles = [];
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(index + 1, points.length - 1)];
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      const normal = Math.atan2(dy, dx) + Math.PI / 2;
      angles.push(normal);
      left.push(offsetPoint(point, normal));
      right.push(offsetPoint(point, normal + Math.PI));
    }

    return [
      ...left,
      ...roundCap(points.at(-1), angles.at(-1)),
      ...right.reverse(),
      ...roundCap(points[0], angles[0] + Math.PI),
    ];
  }

  function strokeContours(stroke) {
    const samples = [];
    for (const point of prepareStroke(stroke)) {
      const last = samples.at(-1);
      if (last && point.x === last.x && point.y === last.y) {
        if (point.width > last.width) {
          samples[samples.length - 1] = point;
        }
      } else {
        samples.push(point);
      }
    }

    const contours = [];
    let start = 0;
    for (let index = 1; index < samples.length - 1; index++) {
      const previous = samples[index - 1];
      const point = samples[index];
      const next = samples[index + 1];
      const incomingX = point.x - previous.x;
      const incomingY = point.y - previous.y;
      const outgoingX = next.x - point.x;
      const outgoingY = next.y - point.y;
      const lengths = Math.hypot(incomingX, incomingY) * Math.hypot(outgoingX, outgoingY);
      const cosine = (incomingX * outgoingX + incomingY * outgoingY) / lengths;
      if (cosine < -0.95) {
        // Close a contour at a hairpin so the left and right sides do not cancel.
        contours.push(buildContour(samples.slice(start, index + 1)));
        start = index;
      }
    }
    contours.push(buildContour(samples.slice(start)));
    return contours;
  }

  function svg(strokes) {
    const outlines = strokes.filter(stroke => stroke.length).map(strokeContours);
    if (!outlines.length) {
      throw Error('請先寫字。');
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const contours of outlines) {
      for (const contour of contours) {
        for (const point of contour) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
      }
    }
    const scale = 284 / Math.max(maxX - minX, maxY - minY, 1);
    const format = value => Number(value.toFixed(5));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const elements = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="300" height="300">'];
    for (const contours of outlines) {
      const path = contours.map(contour => {
        const commands = contour.map((point, index) => {
          const x = format(150 + (point.x - centerX) * scale);
          const y = format(150 + (point.y - centerY) * scale);
          return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
        });
        return `${commands.join(' ')} Z`;
      }).join(' ');
      elements.push(`<path d="${path}" fill="black" fill-rule="nonzero"/>`);
    }
    elements.push('</svg>');
    return elements.join('\n');
  }

  function width(base, pressure, sensitivity) {
    const clampedSensitivity = Math.max(0, Math.min(1, sensitivity));
    const clampedPressure = Math.max(0.15, Math.min(1, pressure));
    return base * (1 - clampedSensitivity * (1 - clampedPressure));
  }

  function parseJSON(raw) {
    const p = JSON.parse(raw);
    if (
      !p || typeof p !== 'object' || Array.isArray(p) ||
      typeof p.title !== 'string' || typeof p.text !== 'string' || p.textUrl !== undefined
    ) {
      throw Error('請提供含 title、text 的稿紙 JSON。');
    }
    title(p.title);
    characters(p.text);
    return p;
  }

  function fitBounds(metrics, size, fraction = 0.85) {
    const extent = Math.max(
      metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
      metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
    );
    if (!Number.isFinite(extent) || extent <= 0) {
      return null;
    }
    return {
      scale: size * fraction / extent,
      x: (metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2,
      y: (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2,
    };
  }
  const api = {
    svgFormat: SVG_FORMAT,
    title,
    characters,
    paper,
    name,
    signature,
    done,
    pairDone,
    count,
    boardFields,
    svg,
    width,
    parseJSON,
    fitBounds
  };
  root.InkTrace = api;
  if (typeof module !== 'undefined') {
    module.exports = api;
  }
})(globalThis);
