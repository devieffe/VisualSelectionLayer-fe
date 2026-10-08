/*
 * setexty: single-layer selection highlight.
 *
 * Drop-in: load setexty.js with a script tag. It applies to every selectable element in <body>
 * and is configured only with CSS variables (defaults are injected with zero specificity, so
 * any `:root { ... }` or class rule overrides them):
 *
 *   --selection-scope      selector of elements that get the merged highlight (default: body)
 *   --selection-exclude    selector of elements that keep the native highlight (default: select)
 *   --selection-effect     show/hide effect tokens: fade blur wipe | none (default: none)
 *   --selection-color, --selection-image(-size|-position|-repeat|-attachment), --selection-opacity, --selection-blend
 *   --selection-text-color  color of selected text (default: unset, text keeps its own color)
 *   --selection-field-color       selection background in fields that can't be measured (email, number,
 *                                 password inputs) (default: --selection-color)
 *   --selection-field-text-color  selected text color in those fields (default: unset)
 *   --selection-pad-x, --selection-pad-y, --selection-radius, --selection-bridge, --selection-jog
 *   --selection-merge      join nearby pieces whose gap (horizontal or vertical) is at most this distance (default: 0px)
 *   --selection-morph-duration/-easing, --selection-effect-duration/-easing/-out-easing
 *   --selection-blur, --selection-z-index
 *
 * Variables can be set on any class: the element that contains the whole selection decides the look.
 * Classes: .setexty-scope (opt in), .setexty-ignore (opt out, native highlight), .setexty-overlay (the layer).
 * API: window.Setexty.refresh(), .enable(), .disable() (removes all styles, layer, and listeners), .enabled
 *   .on(type, fn) -> off(): "show" | "update" | "hide", fn({ overlay, fill, box, effect }).
 *   A "hide" handler may return a promise or a GSAP tween; the layer stays until it settles, so a
 *   JS animation (e.g. GSAP on `fill`, with --selection-effect: none) can play out. See react/ and codepen/.
 */
(() => {
  "use strict";
  if (window.Setexty) return;

  const CLASS = {
    active: "setexty-active",
    layer: "setexty-layer",
    overlay: "setexty-overlay",
    fill: "setexty-overlay__fill",
    scope: "setexty-scope",
    ignore: "setexty-ignore",
    visible: "is-visible",
    instant: "is-instant",
  };
  const DEFAULT_SCOPE = "body";
  const DEFAULT_EXCLUDE = "select";
  // Text fields whose selection offsets are readable get the merged layer too. Other input types
  // (email, number, password...) don't expose selectionStart, so they keep a tinted native highlight.
  const MEASURED_INPUT_TYPES = new Set(["text", "search", "url", "tel"]);
  const MEASURED_FIELDS = 'textarea, input:is(:not([type]), [type="text" i], [type="search" i], [type="url" i], [type="tel" i])';
  const MIRROR_STYLES = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch", "fontVariant", "fontKerning",
    "fontFeatureSettings", "fontVariationSettings", "letterSpacing", "wordSpacing", "textTransform",
    "textIndent", "textAlign", "tabSize", "direction", "paddingTop", "paddingRight", "paddingBottom",
    "paddingLeft",
  ];
  const EFFECTS = new Set(["fade", "blur", "wipe", "none"]);
  const REPLACED_ELEMENTS = "img, video, canvas, picture, iframe, svg, object, embed";
  const SNAP_EPSILON = 1.5;
  const KAPPA = 0.5523;
  const UNCLIPPED = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
  // Variables copied onto the overlay when the selection sits inside an element that overrides them.
  const THEME_VARS = [
    "--selection-color",
    "--selection-image",
    "--selection-image-size",
    "--selection-image-position",
    "--selection-image-repeat",
    "--selection-image-attachment",
    "--selection-opacity",
    "--selection-blend",
    "--selection-z-index",
    "--selection-morph-duration",
    "--selection-morph-easing",
    "--selection-effect-duration",
    "--selection-effect-easing",
    "--selection-effect-out-easing",
    "--selection-blur",
  ];

  // EDIT: engine defaults (zero specificity, so any page rule overrides them).
  const BASE_CSS = `
:where(:root) {
  --selection-scope: ${DEFAULT_SCOPE};
  --selection-exclude: ${DEFAULT_EXCLUDE};
  --selection-effect: none;
  --selection-color: #b6d6ff;
  --selection-image: none;
  --selection-image-size: cover;
  --selection-image-position: center;
  --selection-image-repeat: no-repeat;
  --selection-image-attachment: scroll;
  --selection-opacity: 1;
  --selection-blend: multiply;
  --selection-pad-x: 5px;
  --selection-pad-y: 3px;
  --selection-radius: 9px;
  --selection-bridge: 14px;
  --selection-jog: 6px;
  --selection-merge: 0px;
  --selection-morph-duration: 180ms;
  --selection-morph-easing: cubic-bezier(0.2, 0.7, 0.2, 1);
  --selection-effect-duration: 420ms;
  --selection-effect-easing: cubic-bezier(0.33, 1, 0.68, 1);
  --selection-effect-out-easing: cubic-bezier(0.5, 0, 0.75, 0);
  --selection-blur: 14px;
  --selection-z-index: 10;
}
.${CLASS.layer} {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 0;
  overflow: visible;
  overflow-x: clip;
  pointer-events: none;
}
.${CLASS.overlay} {
  --setexty-morph: var(--selection-morph-duration) var(--selection-morph-easing);
  --setexty-effect: var(--selection-effect-duration) var(--selection-effect-easing);
  --setexty-opacity: var(--setexty-effect);
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  z-index: var(--selection-z-index);
  opacity: 0;
  pointer-events: none;
  mix-blend-mode: var(--selection-blend);
  transform-origin: 50% 50%;
  transition:
    left var(--setexty-morph), top var(--setexty-morph), width var(--setexty-morph), height var(--setexty-morph),
    opacity var(--setexty-opacity), filter var(--setexty-effect),
    clip-path var(--setexty-effect), -webkit-clip-path var(--setexty-effect);
}
.${CLASS.overlay}.${CLASS.visible} { opacity: var(--selection-opacity); }
/* Set for one synchronous style flush: jumps to the new geometry and hidden state without animating. */
.${CLASS.overlay}.${CLASS.instant},
.${CLASS.overlay}.${CLASS.instant} .${CLASS.fill} {
  -webkit-transition: none !important;
  transition: none !important;
}
/* Hiding fades late, so blur/wipe play out before the layer disappears. */
.${CLASS.overlay}[data-effect~="fade"]:not(.${CLASS.visible}) {
  --setexty-opacity: var(--selection-effect-duration) var(--selection-effect-out-easing);
}
.${CLASS.overlay}:not([data-effect~="fade"]):not(.${CLASS.visible}) {
  --setexty-opacity: var(--selection-effect-duration) steps(1, end);
}
.${CLASS.overlay}:not([data-effect~="fade"]).${CLASS.visible} { --setexty-opacity: 0s; }
:is(.${CLASS.overlay}:not(.${CLASS.visible}), .${CLASS.overlay})[data-effect~="none"] {
  --setexty-effect: 0s;
  --setexty-opacity: 0s;
}
.${CLASS.overlay}[data-effect~="blur"]:not(.${CLASS.visible}) { filter: blur(var(--selection-blur)); }
.${CLASS.overlay}[data-effect~="wipe"] { -webkit-clip-path: inset(-50px); clip-path: inset(-50px); }
.${CLASS.overlay}[data-effect~="wipe"]:not(.${CLASS.visible}) {
  -webkit-clip-path: inset(-50px 100% -50px -50px);
  clip-path: inset(-50px 100% -50px -50px);
}
.${CLASS.fill} {
  position: absolute;
  inset: 0;
  background-color: var(--selection-color);
  background-image: var(--selection-image);
  background-size: var(--selection-image-size);
  background-position: var(--selection-image-position);
  background-repeat: var(--selection-image-repeat);
  background-attachment: var(--selection-image-attachment);
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  transition: clip-path var(--setexty-morph), -webkit-clip-path var(--setexty-morph);
}
@media (prefers-reduced-motion: reduce) {
  .${CLASS.overlay} { --setexty-morph: 0s !important; }
  .${CLASS.overlay}:not(.${CLASS.visible}) { filter: none !important; }
  .${CLASS.overlay}[data-effect~="wipe"] { -webkit-clip-path: none !important; clip-path: none !important; }
}
@media print {
  .${CLASS.layer} { display: none !important; }
}
`;

  let layer;
  let overlay;
  let fill;
  let rulesStyle;
  let rulesKey = "";
  let lastSource = null;
  let userEnabled = true;
  let hideToken = 0;
  let box = null;
  const listeners = { show: new Set(), update: new Set(), hide: new Set() };
  const forcedColors = window.matchMedia?.("(forced-colors: active)");
  const warned = new Set();

  // Probe the style object directly: it reflects what the engine actually parses.
  const supports = (property, value) => {
    const probe = document.createElement("div").style;
    probe.setProperty(property, value);
    return probe.getPropertyValue(property) !== "";
  };
  const TEST_PATH = 'path("M0 0H1V1Z")';
  // clip-path: path() morphs smoothly; older engines fall back to the prefixed property or an SVG mask.
  const SHAPE_MODE = supports("clip-path", TEST_PATH)
    ? "clipPath"
    : supports("-webkit-clip-path", TEST_PATH)
      ? "webkitClipPath"
      : "mask";

  function isActive() {
    return userEnabled && !forcedColors?.matches;
  }

  function syncActiveClass() {
    document.documentElement.classList.toggle(CLASS.active, isActive());
  }

  function injectBase() {
    const base = document.createElement("style");
    base.dataset.setexty = "base";
    base.textContent = BASE_CSS;
    rulesStyle = document.createElement("style");
    rulesStyle.dataset.setexty = "rules";
    // Prepend so page styles win at equal specificity.
    document.head.prepend(base, rulesStyle);
  }

  function ensureLayer() {
    overlay = document.querySelector(`.${CLASS.overlay}`) ?? document.createElement("div");
    overlay.classList.add(CLASS.overlay);
    overlay.setAttribute("aria-hidden", "true");
    fill = overlay.querySelector(`.${CLASS.fill}`);
    if (!fill) {
      fill = document.createElement("div");
      fill.className = CLASS.fill;
      overlay.append(fill);
    }
    layer = overlay.closest(`.${CLASS.layer}`);
    if (!layer) {
      layer = document.createElement("div");
      layer.className = CLASS.layer;
      layer.setAttribute("aria-hidden", "true");
      layer.append(overlay);
    }
    // Outside <body>: framework re-renders leave it alone and body styles cannot offset it.
    if (layer.parentNode !== document.documentElement) document.documentElement.append(layer);
  }

  function selectorVar(style, name, fallback) {
    const value = style.getPropertyValue(name).trim().replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
    if (!value) return fallback;
    if (value === "none") return "";
    try {
      document.createDocumentFragment().querySelector(value);
      return value;
    } catch {
      if (!warned.has(value)) {
        warned.add(value);
        console.warn(`setexty: invalid selector in ${name}: "${value}"; using "${fallback}".`);
      }
      return fallback;
    }
  }

  function readConfig() {
    const rootStyle = getComputedStyle(document.documentElement);
    const scope = selectorVar(rootStyle, "--selection-scope", DEFAULT_SCOPE);
    const exclude = selectorVar(rootStyle, "--selection-exclude", DEFAULT_EXCLUDE);
    return {
      rootStyle,
      scope: [scope, `.${CLASS.scope}`].filter(Boolean).join(", "),
      exclude: [exclude, `.${CLASS.ignore}`, `.${CLASS.layer}`].filter(Boolean).join(", "),
    };
  }

  // Hide the native highlight inside the scope and restore it for excluded elements (select,
  // .setexty-ignore). ::selection inherits from the parent in modern browsers, so `revert`/`unset` would
  // stay transparent; the system Highlight colors are what the browser paints natively.
  // Fields the engine can't measure (email, number, password) are tinted with the selection color.
  function syncRules({ scope, exclude }) {
    const key = `${scope}|${exclude}`;
    if (key === rulesKey) return;
    rulesKey = key;
    const on = (selector) => `:where(.${CLASS.active} :is(${selector}))`;
    rulesStyle.textContent = `
${on(scope)}::selection, ${on(scope)} ::selection { color: var(--selection-text-color); background: transparent; }
${on(`input:not(${MEASURED_FIELDS})`)}::selection { color: var(--selection-field-text-color, inherit); background: var(--selection-field-color, var(--selection-color)); }
${on(exclude)}::selection, ${on(exclude)} ::selection { color: HighlightText; background: Highlight; }
`;
  }

  function lengthVar(style, name, fallback) {
    const raw = style.getPropertyValue(name).trim();
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return fallback;
    if (raw.endsWith("rem")) return value * parseFloat(getComputedStyle(document.documentElement).fontSize);
    if (raw.endsWith("em")) return value * parseFloat(style.fontSize);
    return value;
  }

  function effectTokens(style) {
    const tokens = style
      .getPropertyValue("--selection-effect")
      .trim()
      .toLowerCase()
      .split(/[\s,]+/)
      .filter((token) => EFFECTS.has(token));
    return tokens.length ? tokens.join(" ") : "fade";
  }

  function intersect(a, b) {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    return right - left >= 1 && bottom - top >= 1 ? { left, top, right, bottom } : null;
  }

  // Per-render caches for computed styles, scope checks, and scroll-container clipping.
  function createContext({ scope, exclude }) {
    const styles = new Map();
    const allowed = new Map();
    const selectable = new Map();
    const clips = new Map();

    const styleOf = (el) => {
      let style = styles.get(el);
      if (!style) {
        style = getComputedStyle(el);
        styles.set(el, style);
      }
      return style;
    };

    const isSelectable = (el) => {
      if (!el) return true;
      if (selectable.has(el)) return selectable.get(el);
      const style = styleOf(el);
      const value = style.userSelect || style.webkitUserSelect || "auto";
      const result = value === "none" ? false : value === "auto" ? isSelectable(el.parentElement) : true;
      selectable.set(el, result);
      return result;
    };

    const isAllowed = (el) => {
      if (!el) return false;
      if (allowed.has(el)) return allowed.get(el);
      const style = styleOf(el);
      const result =
        el.closest(scope) !== null &&
        el.closest(exclude) === null &&
        style.visibility === "visible" &&
        isSelectable(el);
      allowed.set(el, result);
      return result;
    };

    const clipOf = (el) => {
      if (!el || el === document.body || el === document.documentElement) return UNCLIPPED;
      if (clips.has(el)) return clips.get(el);
      let clip = clipOf(el.parentElement);
      const style = styleOf(el);
      const clipsX = style.overflowX !== "visible";
      const clipsY = style.overflowY !== "visible";
      if ((clipsX || clipsY) && style.display !== "inline" && style.display !== "contents") {
        const r = el.getBoundingClientRect();
        const left = r.left + el.clientLeft;
        const top = r.top + el.clientTop;
        clip = intersect(clip, {
          left: clipsX ? left : -Infinity,
          right: clipsX ? left + el.clientWidth : Infinity,
          top: clipsY ? top : -Infinity,
          bottom: clipsY ? top + el.clientHeight : Infinity,
        }) ?? { left: 0, top: 0, right: 0, bottom: 0 };
      }
      clips.set(el, clip);
      return clip;
    };

    return { exclude, styleOf, isAllowed, clipOf };
  }

  function textRects(node, range) {
    const part = document.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    return part.getClientRects();
  }

  function isContained(node, range) {
    const nodeRange = document.createRange();
    nodeRange.selectNode(node);
    return (
      range.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0 &&
      range.compareBoundaryPoints(Range.END_TO_END, nodeRange) >= 0
    );
  }

  function collectRects(range, ctx) {
    const text = [];
    const boxes = [];
    const add = (list, rects, el) => {
      const clip = ctx.clipOf(el);
      for (const rect of rects) {
        const visible = intersect(rect, clip);
        if (visible) list.push(visible);
      }
    };
    const root = range.commonAncestorContainer;

    if (root.nodeType === Node.TEXT_NODE) {
      if (ctx.isAllowed(root.parentElement)) add(text, textRects(root, range), root.parentElement);
      return { text, boxes };
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
        if (node.nodeType === Node.TEXT_NODE) {
          return ctx.isAllowed(node.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
        if (node.matches(ctx.exclude)) return NodeFilter.FILTER_REJECT;
        if (!ctx.isAllowed(node)) return NodeFilter.FILTER_SKIP;
        if (node.matches(MEASURED_FIELDS)) {
          // A page selection passing over a field takes its whole text (or placeholder) into the shape.
          if (isContained(node, range)) text.push(...fieldRects(node, ctx, true).text);
          return NodeFilter.FILTER_REJECT;
        }
        if (node.matches(REPLACED_ELEMENTS)) {
          add(boxes, [node.getBoundingClientRect()], node.parentElement);
          return NodeFilter.FILTER_REJECT;
        }
        if (ctx.styleOf(node).display === "inline" && isContained(node, range)) {
          // Include inline boxes (padding of tags, code, kbd) so line edges stay aligned.
          add(text, node.getClientRects(), node.parentElement);
        }
        return NodeFilter.FILTER_SKIP;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      add(text, textRects(node, range), node.parentElement);
    }
    return { text, boxes };
  }

  function focusedField() {
    const el = document.activeElement;
    const measurable =
      el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && MEASURED_INPUT_TYPES.has(el.type));
    return measurable && el.selectionStart !== el.selectionEnd ? el : null;
  }

  // Field text isn't in the DOM, so a hidden mirror with the same box, font and scroll offset lays out
  // the value and a Range over the mirrored text gives the selected line boxes in viewport coordinates.
  function fieldRects(field, ctx, whole = false) {
    const text = [];
    if (!ctx.isAllowed(field)) return { text, boxes: [] };
    const style = ctx.styleOf(field);
    const box = field.getBoundingClientRect();
    // Firefox folds padding into clientLeft/clientWidth on inputs, so use the computed borders.
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const isArea = field instanceof HTMLTextAreaElement;
    const inner = {
      left: box.left + borderLeft,
      top: box.top + borderTop,
      // Textareas keep clientWidth/Height so a scrollbar isn't counted as text space.
      width: isArea ? field.clientWidth : box.width - borderLeft - (parseFloat(style.borderRightWidth) || 0),
      height: isArea ? field.clientHeight : box.height - borderTop - (parseFloat(style.borderBottomWidth) || 0),
    };
    const mirror = document.createElement("div");
    for (const name of MIRROR_STYLES) mirror.style[name] = style[name];
    const contentHeight = inner.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    Object.assign(mirror.style, {
      position: "fixed",
      left: `${inner.left}px`,
      top: `${inner.top}px`,
      width: `${inner.width}px`,
      height: `${inner.height}px`,
      boxSizing: "border-box",
      margin: "0",
      border: "0",
      overflow: "hidden",
      visibility: "hidden",
      pointerEvents: "none",
      // Single-line inputs center their line box vertically in the content box.
      lineHeight: isArea ? style.lineHeight : `${contentHeight}px`,
      whiteSpace: isArea ? "pre-wrap" : "pre",
      overflowWrap: isArea ? "break-word" : "normal",
      wordBreak: isArea ? style.wordBreak : "normal",
    });
    const value = whole ? field.value || field.placeholder : field.value;
    const node = document.createTextNode(value);
    mirror.append(node);
    document.documentElement.append(mirror);
    mirror.scrollLeft = field.value ? field.scrollLeft : 0;
    mirror.scrollTop = field.value ? field.scrollTop : 0;
    const length = value.length;
    const range = document.createRange();
    range.setStart(node, whole ? 0 : Math.min(field.selectionStart, field.selectionEnd, length));
    range.setEnd(node, whole ? length : Math.min(Math.max(field.selectionStart, field.selectionEnd), length));
    const clip = intersect(ctx.clipOf(field.parentElement), {
      left: inner.left,
      top: inner.top,
      right: inner.left + inner.width,
      bottom: inner.top + inner.height,
    });
    for (const rect of range.getClientRects()) {
      // Line breaks yield zero-width boxes; the line bridges join the remaining lines.
      const visible = rect.width >= 1 && clip ? intersect(rect, clip) : null;
      if (visible) text.push(visible);
    }
    mirror.remove();
    return { text, boxes: [] };
  }

  function groupLines(rects) {
    const lines = [];
    const sorted = rects
      .map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }))
      .sort((a, b) => a.top - b.top || a.left - b.left);

    for (const rect of sorted) {
      const line = lines.find((l) => {
        const overlap = Math.min(l.bottom, rect.bottom) - Math.max(l.top, rect.top);
        return overlap >= 0.5 * Math.min(l.bottom - l.top, rect.bottom - rect.top);
      });
      if (line) {
        line.top = Math.min(line.top, rect.top);
        line.bottom = Math.max(line.bottom, rect.bottom);
        line.rects.push(rect);
      } else {
        lines.push({ top: rect.top, bottom: rect.bottom, rects: [rect] });
      }
    }
    return lines.sort((a, b) => a.top - b.top);
  }

  function buildRects({ text, boxes }, { padX, padY, bridge }) {
    const bands = [
      ...groupLines(text),
      ...boxes.map((b) => ({ top: b.top, bottom: b.bottom, rects: [b] })),
    ];

    for (const band of bands) {
      band.top -= padY;
      band.bottom += padY;
      band.left = Math.min(...band.rects.map((r) => r.left)) - padX;
      band.right = Math.max(...band.rects.map((r) => r.right)) + padX;
    }

    // Close small vertical gaps between stacked bands so wrapped text and captions read as one shape.
    const bridges = [];
    for (const band of bands) {
      let above = null;
      for (const other of bands) {
        const overlapsX = Math.min(other.right, band.right) > Math.max(other.left, band.left);
        if (other !== band && overlapsX && other.bottom <= band.top && (!above || other.bottom > above.bottom)) {
          above = other;
        }
      }
      if (above && band.top - above.bottom <= bridge) bridges.push([above, band, (above.bottom + band.top) / 2]);
    }
    for (const [above, band, middle] of bridges) {
      above.bottom = Math.max(above.bottom, middle);
      band.top = Math.min(band.top, middle);
    }

    return bands.flatMap((band) =>
      band.rects.map((r) => ({ left: r.left - padX, right: r.right + padX, top: band.top, bottom: band.bottom })),
    );
  }

  // Fill gaps up to `distance` between pieces that face each other, so nearby elements join one shape.
  function mergeNearby(rects, distance) {
    if (!(distance > 0)) return rects;
    const fillers = [];
    for (let i = 0; i < rects.length; i++) {
      const a = rects[i];
      for (let j = i + 1; j < rects.length; j++) {
        const b = rects[j];
        const top = Math.max(a.top, b.top);
        const bottom = Math.min(a.bottom, b.bottom);
        const left = Math.max(a.left, b.left);
        const right = Math.min(a.right, b.right);
        if (bottom - top > 1 && left - right > 0 && left - right <= distance) {
          fillers.push({ left: right, right: left, top, bottom });
        } else if (right - left > 1 && top - bottom > 0 && top - bottom <= distance) {
          fillers.push({ left, right, top: bottom, bottom: top });
        }
      }
    }
    return fillers.length ? rects.concat(fillers) : rects;
  }

  function snapValues(values) {
    const sorted = [...new Set(values)].sort((a, b) => a - b);
    const snapped = new Map();
    let anchor = null;
    for (const value of sorted) {
      if (anchor === null || value - anchor > SNAP_EPSILON) anchor = value;
      snapped.set(value, anchor);
    }
    return snapped;
  }

  // Union rectangles on a compressed grid and trace the outline as closed polygons.
  function traceUnion(rects) {
    const snapX = snapValues(rects.flatMap((r) => [r.left, r.right]));
    const snapY = snapValues(rects.flatMap((r) => [r.top, r.bottom]));
    const xs = [...new Set(snapX.values())];
    const ys = [...new Set(snapY.values())];
    const xIndex = new Map(xs.map((x, i) => [x, i]));
    const yIndex = new Map(ys.map((y, i) => [y, i]));
    const cols = xs.length - 1;
    const rows = ys.length - 1;
    if (cols < 1 || rows < 1) return [];

    const covered = new Uint8Array(cols * rows);
    for (const r of rects) {
      const x0 = xIndex.get(snapX.get(r.left));
      const x1 = xIndex.get(snapX.get(r.right));
      const y0 = yIndex.get(snapY.get(r.top));
      const y1 = yIndex.get(snapY.get(r.bottom));
      for (let j = y0; j < y1; j += 1) {
        for (let i = x0; i < x1; i += 1) covered[j * cols + i] = 1;
      }
    }
    const isCovered = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows && covered[j * cols + i] === 1;

    // Directed edges run clockwise around covered cells (interior on the right).
    const edges = [];
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        if (!isCovered(i, j)) continue;
        if (!isCovered(i, j - 1)) edges.push([i, j, i + 1, j]);
        if (!isCovered(i + 1, j)) edges.push([i + 1, j, i + 1, j + 1]);
        if (!isCovered(i, j + 1)) edges.push([i + 1, j + 1, i, j + 1]);
        if (!isCovered(i - 1, j)) edges.push([i, j + 1, i, j]);
      }
    }

    const key = (i, j) => i * (rows + 2) + j;
    const outgoing = new Map();
    edges.forEach((edge, index) => {
      const k = key(edge[0], edge[1]);
      if (!outgoing.has(k)) outgoing.set(k, []);
      outgoing.get(k).push(index);
    });

    const used = new Uint8Array(edges.length);
    const loops = [];
    for (let start = 0; start < edges.length; start += 1) {
      if (used[start]) continue;
      const points = [];
      let current = start;
      while (current !== -1 && !used[current]) {
        used[current] = 1;
        const [x0, y0, x1, y1] = edges[current];
        points.push([x0, y0]);
        const dx = x1 - x0;
        const dy = y1 - y0;
        let best = -1;
        let bestTurn = -Infinity;
        for (const candidate of outgoing.get(key(x1, y1)) ?? []) {
          if (used[candidate]) continue;
          const [cx0, cy0, cx1, cy1] = edges[candidate];
          const turn = dx * (cy1 - cy0) - dy * (cx1 - cx0);
          if (turn > bestTurn) {
            bestTurn = turn;
            best = candidate;
          }
        }
        current = best;
      }
      const simplified = points.filter((point, i) => {
        const prev = points[(i - 1 + points.length) % points.length];
        const next = points[(i + 1) % points.length];
        return (point[0] - prev[0]) * (next[1] - point[1]) !== (point[1] - prev[1]) * (next[0] - point[0]);
      });
      if (simplified.length >= 4) loops.push(simplified.map(([i, j]) => [xs[i], ys[j]]));
    }
    return loops;
  }

  function turnAt(prev, point, next) {
    return Math.sign((point[0] - prev[0]) * (next[1] - point[1]) - (point[1] - prev[1]) * (next[0] - point[0]));
  }

  // Round every vertex, convex or concave. Short steps between two opposite turns
  // (e.g. a 2–3px offset between line edges) become one smooth S-curve instead of two tiny corners.
  function roundedPath(loops, radius, jogMax) {
    const f = (n) => Math.round(n * 100) / 100;
    const at = (points, i) => points[(i + points.length) % points.length];
    const toward = (from, to, distance) => {
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      return [from[0] + ((to[0] - from[0]) / length) * distance, from[1] + ((to[1] - from[1]) / length) * distance];
    };
    const edgeLength = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

    return loops
      .map((points) => {
        const count = points.length;
        const jogStart = new Uint8Array(count);
        const consumed = new Uint8Array(count);
        for (let i = 0; i < count; i += 1) {
          const j = (i + 1) % count;
          if (consumed[i] || consumed[j]) continue;
          const short = edgeLength(points[i], points[j]) <= jogMax;
          const opposite = turnAt(at(points, i - 1), points[i], points[j]) === -turnAt(points[i], points[j], at(points, j + 1));
          if (short && opposite) {
            jogStart[i] = 1;
            consumed[i] = 1;
            consumed[j] = 1;
          }
        }

        // Each regular edge is shared by two features, so each may use up to half of it.
        const budget = (a, b) => edgeLength(a, b) / 2;
        const segments = [];
        for (let i = 0; i < count; i += 1) {
          if (consumed[i] && !jogStart[i]) continue;
          const prev = at(points, i - 1);
          const current = points[i];
          if (jogStart[i]) {
            const next = at(points, i + 1);
            const after = at(points, i + 2);
            const r = Math.min(radius, budget(prev, current), budget(next, after));
            const start = toward(current, prev, r);
            const end = toward(next, after, r);
            segments.push(`${f(start[0])} ${f(start[1])}`, `C${f(current[0])} ${f(current[1])} ${f(next[0])} ${f(next[1])} ${f(end[0])} ${f(end[1])}`);
          } else {
            const next = at(points, i + 1);
            const r = Math.min(radius, budget(prev, current), budget(current, next));
            const a = toward(current, prev, r);
            const b = toward(current, next, r);
            const c1 = [a[0] + (current[0] - a[0]) * KAPPA, a[1] + (current[1] - a[1]) * KAPPA];
            const c2 = [b[0] + (current[0] - b[0]) * KAPPA, b[1] + (current[1] - b[1]) * KAPPA];
            segments.push(`${f(a[0])} ${f(a[1])}`, `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(b[0])} ${f(b[1])}`);
          }
        }

        let d = "";
        for (let k = 0; k < segments.length; k += 2) d += `${k === 0 ? "M" : "L"}${segments[k]}${segments[k + 1]}`;
        return `${d}Z`;
      })
      .join("");
  }

  function setShape(d, width, height) {
    if (SHAPE_MODE === "mask") {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="${d}"/></svg>`;
      const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
      fill.style.webkitMaskImage = url;
      fill.style.maskImage = url;
    } else {
      fill.style[SHAPE_MODE] = `path("${d}")`;
    }
  }

  function applyTheme(sourceStyle, rootStyle) {
    for (const name of THEME_VARS) {
      const value = sourceStyle.getPropertyValue(name);
      if (value && value !== rootStyle.getPropertyValue(name)) overlay.style.setProperty(name, value);
      else overlay.style.removeProperty(name);
    }
    overlay.dataset.effect = effectTokens(sourceStyle);
  }

  // Listener errors are reported but never break rendering. Returns whatever the handlers returned.
  function emit(type) {
    const detail = { overlay, fill, box, effect: overlay.dataset.effect };
    return [...listeners[type]].map((fn) => {
      try {
        return fn(detail);
      } catch (error) {
        console.error(error);
        return null;
      }
    });
  }

  function hide() {
    if (!overlay.classList.contains(CLASS.visible) || hideToken) return;
    // Pick up an effect change made while the selection was visible before animating out.
    const style = lastSource?.isConnected ? getComputedStyle(lastSource) : null;
    const effect = style ? effectTokens(style) : overlay.dataset.effect;
    if (effect !== overlay.dataset.effect) {
      overlay.classList.add(CLASS.instant);
      overlay.dataset.effect = effect;
      void getComputedStyle(overlay).opacity;
      overlay.classList.remove(CLASS.instant);
    }
    const pending = emit("hide").filter((result) => typeof result?.then === "function");
    if (pending.length === 0) {
      overlay.classList.remove(CLASS.visible);
      return;
    }
    // Wait for JS hide animations; a new selection in the meantime cancels the removal.
    const token = (hideToken = Math.random() + 1);
    Promise.allSettled(pending).then(() => {
      if (hideToken !== token || !overlay) return;
      hideToken = 0;
      overlay.classList.remove(CLASS.visible);
    });
  }

  function selectedRanges() {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return [];
    const ranges = [];
    for (let i = 0; i < selection.rangeCount; i += 1) {
      const range = selection.getRangeAt(i);
      if (!range.collapsed) ranges.push(range);
    }
    return ranges;
  }

  // The overlay box is sized to the selection bounds so background images anchor to the selection
  // (unless --selection-image-attachment is fixed, which pins them to the viewport),
  // and the merged outline is applied as a clip-path (or mask) relative to that box.
  function render() {
    frame = 0;
    if (!mounted) return;
    const instant = pendingInstant;
    pendingInstant = false;
    const config = readConfig();
    syncRules(config);
    // A focused text field owns the visible selection; the document selection only sits around it.
    const field = isActive() ? focusedField() : null;
    const ranges = field || !isActive() ? [] : selectedRanges();
    if (!field && ranges.length === 0) {
      hide();
      return;
    }

    const container = field ?? ranges[0].commonAncestorContainer;
    const source = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement ?? document.documentElement;
    const sourceStyle = getComputedStyle(source);
    lastSource = source;
    const geometry = {
      padX: lengthVar(sourceStyle, "--selection-pad-x", 5),
      padY: lengthVar(sourceStyle, "--selection-pad-y", 3),
      bridge: lengthVar(sourceStyle, "--selection-bridge", 14),
      merge: lengthVar(sourceStyle, "--selection-merge", 0),
    };
    geometry.bridge = Math.max(geometry.bridge, geometry.merge);
    const ctx = createContext(config);
    const pieces = field ? [fieldRects(field, ctx)] : ranges.map((range) => collectRects(range, ctx));
    const rects = mergeNearby(
      pieces.flatMap((piece) => buildRects(piece, geometry)),
      geometry.merge,
    );
    const loops = traceUnion(rects);
    if (loops.length === 0) {
      hide();
      return;
    }

    const xs = loops.flat().map((p) => p[0]);
    const ys = loops.flat().map((p) => p[1]);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const width = Math.max(...xs) - left;
    const height = Math.max(...ys) - top;
    const local = loops.map((loop) => loop.map(([x, y]) => [x - left, y - top]));
    const d = roundedPath(
      local,
      lengthVar(sourceStyle, "--selection-radius", 9),
      lengthVar(sourceStyle, "--selection-jog", 6),
    );
    // The layer sits at the document origin, so page scrolling moves the overlay natively.
    const origin = layer.getBoundingClientRect();

    // Appearing from nothing or following a scroll/resize should not morph from stale geometry.
    const appearing = !overlay.classList.contains(CLASS.visible) || hideToken !== 0;
    const snap = instant || !overlay.classList.contains(CLASS.visible);
    hideToken = 0;
    box = { left, top, width, height };
    // A snap applies the new effect's hidden state and geometry with transitions off, so the show
    // animation always starts from the current effect instead of the previous one.
    if (snap) overlay.classList.add(CLASS.instant);
    applyTheme(sourceStyle, config.rootStyle);
    Object.assign(overlay.style, {
      left: `${left - origin.left}px`,
      top: `${top - origin.top}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    setShape(d, Math.round(width * 100) / 100, Math.round(height * 100) / 100);
    if (snap) {
      void getComputedStyle(fill).clipPath;
      void overlay.offsetWidth;
      overlay.classList.remove(CLASS.instant);
    }
    overlay.classList.add(CLASS.visible);
    emit(appearing ? "show" : "update");
  }

  let frame = 0;
  let pendingInstant = false;
  function scheduleRender(instant = false) {
    pendingInstant = pendingInstant || instant === true;
    if (!frame) frame = requestAnimationFrame(render);
  }
  const scheduleInstant = () => scheduleRender(true);

  let mounted = false;
  let teardown = null;

  // Enabled: styles, layer, listeners, and observers are attached. Disabled: every trace is removed,
  // so the page shows the browser's own selection exactly as if the script were never loaded.
  function mount() {
    if (mounted) return;
    mounted = true;
    injectBase();
    ensureLayer();
    syncActiveClass();

    const controller = new AbortController();
    const { signal } = controller;
    const observers = [];
    // While a new selection is being dragged out the shape follows the pointer without morphing;
    // transitions are kept for later changes (keyboard extension, programmatic, variable updates).
    // Browsers deliver the last selectionchange of a drag asynchronously, sometimes after pointerup,
    // so the drag counts as ongoing a little longer; otherwise that final step would morph behind the pointer.
    // On touch screens the selection is adjusted with the browser's own handles, which send no pointer
    // events to the page, so after a touch every selection change follows the finger without morphing.
    let dragging = false;
    let dragEndTimer = 0;
    let touch = false;
    document.addEventListener("pointerdown", (event) => {
      clearTimeout(dragEndTimer);
      touch = event.pointerType !== "mouse";
      dragging = event.button === 0;
    }, { capture: true, signal });
    document.addEventListener("keydown", () => { touch = false; }, { capture: true, signal });
    const endDrag = () => {
      clearTimeout(dragEndTimer);
      dragEndTimer = setTimeout(() => { dragging = false; }, 300);
    };
    signal.addEventListener("abort", () => clearTimeout(dragEndTimer));
    window.addEventListener("pointerup", endDrag, { capture: true, signal });
    window.addEventListener("pointercancel", endDrag, { capture: true, signal });
    window.addEventListener("blur", endDrag, { signal });
    // Captured so field selections count too: some engines fire selectionchange only on the field.
    for (const type of ["selectionchange", "select", "input", "focusin", "focusout"]) {
      document.addEventListener(type, () => scheduleRender(dragging || touch), { capture: true, signal });
    }
    window.addEventListener("resize", scheduleInstant, { signal });
    window.addEventListener("scroll", scheduleInstant, { capture: true, passive: true, signal });
    window.visualViewport?.addEventListener("resize", scheduleInstant, { signal });
    // Images, video posters, and fonts change layout after load.
    document.addEventListener("load", scheduleInstant, { capture: true, signal });
    document.fonts?.ready.then(() => mounted && scheduleInstant());
    if (window.ResizeObserver) {
      const resize = new ResizeObserver(scheduleInstant);
      resize.observe(document.body);
      observers.push(resize);
    }
    // Variables or classes changed on <html>/<body> (themes, scope, effect) apply immediately.
    for (const target of [document.documentElement, document.body]) {
      const mutation = new MutationObserver(() => scheduleRender());
      mutation.observe(target, { attributes: true, attributeFilter: ["style", "class"] });
      observers.push(mutation);
    }

    teardown = () => {
      controller.abort();
      observers.forEach((observer) => observer.disconnect());
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pendingInstant = false;
      document.documentElement.classList.remove(CLASS.active);
      document.querySelectorAll("style[data-setexty]").forEach((style) => style.remove());
      layer?.remove();
      layer = overlay = fill = rulesStyle = null;
      rulesKey = "";
      lastSource = null;
      hideToken = 0;
      box = null;
    };
    scheduleRender(true);
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;
    teardown();
    teardown = null;
  }

  function sync() {
    if (isActive()) mount();
    else unmount();
  }

  function setEnabled(value) {
    userEnabled = value;
    sync();
  }

  function init() {
    forcedColors?.addEventListener?.("change", sync);
    sync();
  }

  window.Setexty = {
    refresh: () => scheduleRender(),
    enable: () => setEnabled(true),
    disable: () => setEnabled(false),
    get enabled() {
      return isActive();
    },
    on(type, fn) {
      if (!listeners[type]) throw new TypeError(`setexty: unknown event "${type}"`);
      listeners[type].add(fn);
      return () => listeners[type].delete(fn);
    },
  };

  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init, { once: true });
})();
