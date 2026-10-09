/*
 * visual-selection-layer: single-layer selection highlight.
 *
 * Drop-in: load VisualSelectionLayer.js with a script tag. It applies to every selectable element in <body>
 * and is configured only with CSS variables (defaults are injected with zero specificity, so
 * any `:root { ... }` or class rule overrides them):
 *
 *   --selection-scope      selector of elements that get the merged highlight (default: body)
 *   --selection-exclude    selector of elements that keep the native highlight (default: select)
 *   --selection-effect     show/hide effect tokens: fade blur wipe | none (default: none)
 *   --selection-color, --selection-image(-size|-position|-repeat|-attachment), --selection-opacity, --selection-blend
 *   --selection-image-anchor  page | selection | auto (default): page pins the image to the document,
 *                             so a pattern never shifts as the selection changes; auto uses page for
 *                             repeating images and selection for no-repeat ones
 *   --selection-text-color  color of selected text (default: unset, text keeps its own color); on
 *                           deselect it fades back to each element's own color with the hide effect
 *   --selection-media-opacity  translucent selection tint over selected images, video and other media
 *                              when the layer sits behind content (negative --selection-z-index) (default: 0.35)
 *   --selection-field-color       selection background in fields that can't be measured (email, number,
 *                                 password inputs) (default: --selection-color)
 *   --selection-field-text-color  selected text color in those fields (default: unset)
 *   --selection-pad-x, --selection-pad-y, --selection-radius, --selection-bridge, --selection-jog
 *   --selection-merge      join nearby pieces whose gap (horizontal or vertical) is at most this distance (default: 0px)
 *   --selection-morph-duration/-easing, --selection-effect-duration/-easing/-out-easing
 *   --selection-blur, --selection-z-index
 *
 * Variables can be set on any class: the element that contains the whole selection decides the look.
 * Same-origin iframes get their own layer with the page's --selection-* theme (cross-origin ones are tinted boxes).
 * user-select: none elements inside a selection are covered as whole tinted boxes, like media.
 * Classes: .visual-selection-layer-scope (opt in), .visual-selection-layer-ignore (opt out, native highlight), .visual-selection-layer-overlay (the layer).
 * API: window.VisualSelectionLayer.refresh(), .enable(), .disable() (removes all styles, layer, and listeners), .enabled
 *   .on(type, fn) -> off(): "show" | "update" | "hide", fn({ overlay, fill, box, loops, effect }).
 *   loops are the outlines of the shape in overlay coordinates ([[x, y], ...] each; holes run counterclockwise).
 *   A "hide" handler may return a promise or a GSAP tween; the layer stays until it settles, so a
 *   JS animation (e.g. GSAP on `fill`, with --selection-effect: none) can play out. See react/ and codepen/.
 */
(() => {
  "use strict";
  if (window.VisualSelectionLayer) return;
  const installed = new WeakSet();
  const api = install(window);
  installed.add(api);
  window.VisualSelectionLayer = api;

  function install(window) {
    // Every global comes from the target window, so the engine also runs inside same-origin iframes.
    const {
      document, Node, NodeFilter, Range, CSS, Highlight, HTMLInputElement, HTMLTextAreaElement,
      ResizeObserver, MutationObserver, AbortController,
    } = window;
    const getComputedStyle = (element, pseudo) => window.getComputedStyle(element, pseudo);
    const requestAnimationFrame = (callback) => window.requestAnimationFrame(callback);
    const cancelAnimationFrame = (id) => window.cancelAnimationFrame(id);

    const CLASS = {
      active: "visual-selection-layer-active",
      layer: "visual-selection-layer-layer",
      overlay: "visual-selection-layer-overlay",
      fill: "visual-selection-layer-overlay__fill",
      tints: "visual-selection-layer-tints",
      scope: "visual-selection-layer-scope",
      ignore: "visual-selection-layer-ignore",
      visible: "is-visible",
      instant: "is-instant",
    };
    const ATTR = { covered: "data-visual-selection-layer-covered" };
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
    // Elements without selectable text that the selection takes in as whole boxes (and tints as media).
    const REPLACED_ELEMENTS = [
      "img, video, audio, canvas, picture, iframe, frame, svg, math, object, embed, meter, progress,",
      'input:is([type="checkbox" i], [type="radio" i], [type="range" i], [type="color" i], [type="image" i],',
      '[type="file" i], [type="button" i], [type="submit" i], [type="reset" i], [type="date" i],',
      '[type="datetime-local" i], [type="month" i], [type="week" i], [type="time" i])',
    ].join(" ");
    const EXTEND_KEYS = new Set([
      "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown",
    ]);
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
      "--selection-media-opacity",
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
    --selection-image-anchor: auto;
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
    --selection-media-opacity: 0.35;
  }
  @property --visual-selection-layer-fade { syntax: "<percentage>"; inherits: true; initial-value: 0%; }
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
    --visual-selection-layer-morph: var(--selection-morph-duration) var(--selection-morph-easing);
    --visual-selection-layer-effect: var(--selection-effect-duration) var(--selection-effect-easing);
    --visual-selection-layer-opacity: var(--visual-selection-layer-effect);
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
      left var(--visual-selection-layer-morph), top var(--visual-selection-layer-morph), width var(--visual-selection-layer-morph), height var(--visual-selection-layer-morph),
      opacity var(--visual-selection-layer-opacity), filter var(--visual-selection-layer-effect),
      clip-path var(--visual-selection-layer-effect), -webkit-clip-path var(--visual-selection-layer-effect);
  }
  :is(.${CLASS.overlay}, .${CLASS.tints}).${CLASS.visible} { opacity: var(--selection-opacity); }
  /* Set for one synchronous style flush: jumps to the new geometry and hidden state without animating. */
  :is(.${CLASS.overlay}, .${CLASS.tints}).${CLASS.instant},
  .${CLASS.overlay}.${CLASS.instant} .${CLASS.fill} {
    -webkit-transition: none !important;
    transition: none !important;
  }
  .${CLASS.overlay}.${CLASS.instant} .${CLASS.fill}::before { transition: none !important; }
  /* Hiding fades late, so blur/wipe play out before the layer disappears. */
  :is(.${CLASS.overlay}, .${CLASS.tints})[data-effect~="fade"]:not(.${CLASS.visible}) {
    --visual-selection-layer-opacity: var(--selection-effect-duration) var(--selection-effect-out-easing);
  }
  :is(.${CLASS.overlay}, .${CLASS.tints}):not([data-effect~="fade"]):not(.${CLASS.visible}) {
    --visual-selection-layer-opacity: var(--selection-effect-duration) steps(1, end);
  }
  :is(.${CLASS.overlay}, .${CLASS.tints}):not([data-effect~="fade"]).${CLASS.visible} { --visual-selection-layer-opacity: 0s; }
  :is(.${CLASS.overlay}, .${CLASS.tints})[data-effect~="none"] {
    --visual-selection-layer-effect: 0s;
    --visual-selection-layer-opacity: 0s;
  }
  :is(.${CLASS.overlay}, .${CLASS.tints})[data-effect~="blur"]:not(.${CLASS.visible}) { filter: blur(var(--selection-blur)); }
  .${CLASS.overlay}[data-effect~="wipe"] { -webkit-clip-path: inset(-50px); clip-path: inset(-50px); }
  .${CLASS.overlay}[data-effect~="wipe"]:not(.${CLASS.visible}) {
    -webkit-clip-path: inset(-50px 100% -50px -50px);
    clip-path: inset(-50px 100% -50px -50px);
  }
  /* Media paints above a layer that sits behind content, so selected media get their own translucent tint. */
  /* They share the overlay's show/hide rules, so they fade and blur with exactly the same timing. */
  .${CLASS.tints} {
    --visual-selection-layer-effect: var(--selection-effect-duration) var(--selection-effect-easing);
    --visual-selection-layer-opacity: var(--visual-selection-layer-effect);
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--visual-selection-layer-opacity), filter var(--visual-selection-layer-effect);
  }
  .${CLASS.tints} > div {
    position: absolute;
    background: var(--selection-color);
    opacity: var(--selection-media-opacity);
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
    /* background-position moves opposite to the overlay with the same timing, so a page-anchored image stays put. */
    transition: clip-path var(--visual-selection-layer-morph), -webkit-clip-path var(--visual-selection-layer-morph),
      background-position var(--visual-selection-layer-morph);
  }
  /* A viewport-sized surface avoids mobile fixed-background quirks and page-anchor offsets. */
  .${CLASS.fill}[data-image-fixed] { background-image: none; }
  .${CLASS.fill}[data-image-fixed]::before {
    content: "";
    position: absolute;
    left: var(--visual-selection-layer-viewport-x);
    top: var(--visual-selection-layer-viewport-y);
    width: var(--visual-selection-layer-viewport-width);
    height: var(--visual-selection-layer-viewport-height);
    background-image: var(--selection-image);
    background-size: var(--selection-image-size);
    background-position: var(--selection-image-position);
    background-repeat: var(--selection-image-repeat);
    transition: left var(--visual-selection-layer-morph), top var(--visual-selection-layer-morph);
  }
  @media (prefers-reduced-motion: reduce) {
    .${CLASS.overlay} { --visual-selection-layer-morph: 0s !important; }
    :is(.${CLASS.overlay}, .${CLASS.tints}):not(.${CLASS.visible}) { filter: none !important; }
    .${CLASS.overlay}[data-effect~="wipe"] { -webkit-clip-path: none !important; clip-path: none !important; }
  }
  @media print {
    .${CLASS.layer} { display: none !important; }
  }
  `;

    let layer;
    let overlay;
    let fill;
    let tints;
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
      base.dataset.visualSelectionLayer = "base";
      base.textContent = BASE_CSS;
      rulesStyle = document.createElement("style");
      rulesStyle.dataset.visualSelectionLayer = "rules";
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
      tints = layer.querySelector(`.${CLASS.tints}`);
      if (!tints) {
        tints = document.createElement("div");
        tints.className = CLASS.tints;
        layer.append(tints);
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
          console.warn(`visual-selection-layer: invalid selector in ${name}: "${value}"; using "${fallback}".`);
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
    // .visual-selection-layer-ignore). ::selection inherits from the parent in modern browsers, so `revert`/`unset` would
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
    function createContext({ scope, exclude }, layerZ = 0) {
      const styles = new Map();
      const allowed = new Map();
      const selectable = new Map();
      const clips = new Map();
      const paints = new Map();

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

      // The outermost user-select: none element inside the scope. The selection skips its content, so the
      // layer takes it in as one whole box and covers it like media instead of leaving a hole around it.
      const isUnselectableBox = (el) =>
        !isSelectable(el) &&
        isSelectable(el.parentElement) &&
        el.closest(scope) !== null &&
        el.closest(exclude) === null &&
        styleOf(el).visibility === "visible";

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

      // Stacking level of an element that starts a stacking context, null otherwise.
      const stackLevel = (el, style) => {
        const parent = el.parentElement && styleOf(el.parentElement).display;
        const item = /flex|grid/.test(parent ?? "");
        if (style.zIndex !== "auto" && (style.position !== "static" || item)) return parseInt(style.zIndex, 10) || 0;
        const creates =
          style.position === "fixed" ||
          style.position === "sticky" ||
          style.transform !== "none" ||
          style.filter !== "none" ||
          style.opacity !== "1" ||
          style.isolation === "isolate" ||
          style.mixBlendMode !== "normal" ||
          /paint|strict|content/.test(style.contain);
        return creates ? 0 : null;
      };
      const NO_PAINT = { cover: null, z: null, inner: null };
      // cover: outermost ancestor with a painted background; z: level of the outermost stacking context;
      // inner: outermost painted ancestor inside that context.
      const paintOf = (el) => {
        if (!el || el === document.body || el === document.documentElement) return NO_PAINT;
        if (paints.has(el)) return paints.get(el);
        const parent = paintOf(el.parentElement);
        const style = styleOf(el);
        const painted =
          style.backgroundImage !== "none" || !/^transparent$|[,/]\s*0\)$/.test(style.backgroundColor);
        const own = painted ? el : null;
        const level = parent.z === null ? stackLevel(el, style) : parent.z;
        const result = {
          own,
          cover: parent.cover ?? own,
          z: level,
          inner: parent.z !== null ? parent.inner ?? own : level !== null ? own : null,
        };
        paints.set(el, result);
        return result;
      };
      // The layer paints at --selection-z-index in the root stacking context. Behind content (negative),
      // any painted box covers it; above content, only boxes inside a higher stacking context do.
      const coverOf = (el) => {
        const { cover, z, inner } = paintOf(el);
        if (layerZ < 0) return z !== null && z < layerZ ? null : cover;
        return z !== null && z > layerZ ? inner : null;
      };
      // Painted boxes from el up to its cover: each one paints the part of the shape that lies on it,
      // so nested chips and buttons inside a menu or dialog keep the selection too.
      const paintedChain = (el, cover) => {
        const chain = [];
        for (let node = el; node; node = node.parentElement) {
          if (paintOf(node).own) chain.push(node);
          if (node === cover) break;
        }
        return chain;
      };

      return { exclude, styleOf, isAllowed, isUnselectableBox, clipOf, coverOf, paintedChain };
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
      const media = [];
      const covers = new Map();
      const add = (list, rects, el) => {
        const cover = list === text ? ctx.coverOf(el) : null;
        // Text under an opaque box that sits above the layer goes to that box's own shape instead.
        const targets = cover
          ? ctx.paintedChain(el, cover).map((box) => covers.get(box) ?? covers.set(box, []).get(box))
          : [list];
        const clip = ctx.clipOf(el);
        for (const rect of rects) {
          const visible = intersect(rect, clip);
          if (visible) targets.forEach((target) => target.push(visible));
        }
      };
      const root = range.commonAncestorContainer;

      if (root.nodeType === Node.TEXT_NODE) {
        if (ctx.isAllowed(root.parentElement)) add(text, textRects(root, range), root.parentElement);
        return { text, boxes, media, covers };
      }

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
          if (node.nodeType === Node.TEXT_NODE) {
            return ctx.isAllowed(node.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
          if (node.matches(ctx.exclude)) return NodeFilter.FILTER_REJECT;
          if (ctx.isUnselectableBox(node)) {
            const rect = node.getBoundingClientRect();
            if (rect.width >= 1 && rect.height >= 1 && isContained(node, range)) {
              const count = boxes.length;
              add(boxes, [rect], node.parentElement);
              if (boxes.length > count) media.push({ el: node, rect: boxes[count] });
            }
            return NodeFilter.FILTER_REJECT;
          }
          if (!ctx.isAllowed(node)) return NodeFilter.FILTER_SKIP;
          if (node.matches(MEASURED_FIELDS)) {
            // A page selection passing over a field takes its whole text (or placeholder) into the shape.
            if (isContained(node, range)) {
              const field = fieldRects(node, ctx, true);
              text.push(...field.text);
              for (const [box, list] of field.covers) {
                if (!covers.has(box)) covers.set(box, []);
                covers.get(box).push(...list);
              }
            }
            return NodeFilter.FILTER_REJECT;
          }
          if (node.matches(REPLACED_ELEMENTS)) {
            const rect = node.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) return NodeFilter.FILTER_REJECT;
            const count = boxes.length;
            add(boxes, [rect], node.parentElement);
            if (boxes.length > count) media.push({ el: node, rect: boxes[count] });
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
      return { text, boxes, media, covers };
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
      if (!ctx.isAllowed(field)) return { text, boxes: [], covers: new Map() };
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
      const cover = ctx.coverOf(field);
      if (!cover) return { text, boxes: [], covers: new Map() };
      return { text: [], boxes: [], covers: new Map(ctx.paintedChain(field, cover).map((box) => [box, text])) };
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
        for (const el of [overlay, tints]) {
          if (value && value !== rootStyle.getPropertyValue(name)) el.style.setProperty(name, value);
          else el.style.removeProperty(name);
        }
      }
      overlay.dataset.effect = tints.dataset.effect = effectTokens(sourceStyle);
    }

    // Listener errors are reported but never break rendering. Returns whatever the handlers returned.
    function emit(type) {
      const detail = { overlay, fill, box, loops: shapeLoops, effect: overlay.dataset.effect };
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
        for (const el of [overlay, tints]) {
          el.classList.add(CLASS.instant);
          el.dataset.effect = effect;
          void getComputedStyle(el).opacity;
          el.classList.remove(CLASS.instant);
        }
      }
      const pending = emit("hide").filter((result) => typeof result?.then === "function");
      if (pending.length === 0) {
        fadeOut(effect);
        return;
      }
      // Wait for JS hide animations; a new selection in the meantime cancels the removal.
      const token = (hideToken = Math.random() + 1);
      Promise.allSettled(pending).then(() => {
        if (hideToken !== token || !overlay) return;
        hideToken = 0;
        fadeOut(overlay.dataset.effect);
      });
    }

    // A painted box above the layer (menu, sticky bar, dialog) would hide it, so the box paints the same
    // rounded shape as its topmost background image: above its own background, below its content.
    // The image follows the overlay's opacity frame by frame, so it shows and hides in step with the layer.
    const BACKGROUND = ["backgroundImage", "backgroundPosition", "backgroundSize", "backgroundRepeat", "backgroundOrigin"];
    let covers = new Map();
    let coverFrame = 0;

    function paintCover(el, state) {
      const { width, height, d, color, opacity, computed } = state;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path fill="${color}" fill-opacity="${opacity}" d="${d}"/></svg>`;
      const own = [`url("data:image/svg+xml,${encodeURIComponent(svg)}")`, "0 0", `${width}px ${height}px`, "no-repeat", "border-box"];
      const keep = computed.backgroundImage !== "none";
      BACKGROUND.forEach((name, i) => {
        el.style[name] = keep ? `${own[i]}, ${computed[name]}` : own[i];
      });
    }

    function restoreCover(el, state) {
      for (const name of BACKGROUND) el.style[name] = state.saved[name];
      el.removeAttribute(ATTR.covered);
    }

    function setCovers(shapes) {
      for (const [el, state] of covers) if (!shapes.has(el)) restoreCover(el, state);
      const next = new Map();
      for (const [el, shape] of shapes) {
        let state = covers.get(el);
        if (!state) {
          const style = getComputedStyle(el);
          state = {
            saved: Object.fromEntries(BACKGROUND.map((name) => [name, el.style[name]])),
            computed: Object.fromEntries(BACKGROUND.map((name) => [name, style[name]])),
          };
          el.setAttribute(ATTR.covered, "");
        }
        Object.assign(state, shape, { opacity: coverOpacity() });
        paintCover(el, state);
        next.set(el, state);
      }
      covers = next;
      syncCovers();
    }

    function clearCovers() {
      if (coverFrame) cancelAnimationFrame(coverFrame);
      coverFrame = 0;
      for (const [el, state] of covers) restoreCover(el, state);
      covers = new Map();
    }

    const coverOpacity = () => Math.round(parseFloat(getComputedStyle(overlay).opacity) * 1000) / 1000;

    function syncCovers() {
      if (coverFrame) cancelAnimationFrame(coverFrame);
      coverFrame = 0;
      if (!overlay || covers.size === 0) return;
      const opacity = coverOpacity();
      for (const [el, state] of covers) {
        if (state.opacity === opacity) continue;
        state.opacity = opacity;
        paintCover(el, state);
      }
      const fading = overlay.getAnimations?.().some((animation) => animation.transitionProperty === "opacity");
      if (fading) coverFrame = requestAnimationFrame(syncCovers);
      else if (!overlay.classList.contains(CLASS.visible)) clearCovers();
    }

    // Tints sit on the selected media at their own rounded corners; they only appear when the layer is
    // behind content, since a layer above content already covers media.
    function renderTints(pieces, sourceStyle, origin) {
      const behind = parseFloat(sourceStyle.getPropertyValue("--selection-z-index")) < 0;
      const media = behind ? pieces.flatMap((piece) => piece.media ?? []) : [];
      tints.replaceChildren(
        ...media.map(({ el, rect }) => {
          const tint = document.createElement("div");
          const style = getComputedStyle(el);
          Object.assign(tint.style, {
            left: `${rect.left - origin.left}px`,
            top: `${rect.top - origin.top}px`,
            width: `${rect.right - rect.left}px`,
            height: `${rect.bottom - rect.top}px`,
            borderRadius: style.borderRadius,
          });
          return tint;
        }),
      );
    }

    // ::selection vanishes the moment the selection clears, so the text that was selected is kept in
    // custom highlights whose color animates from --selection-text-color back to the element's own color
    // (currentColor can't be used: inside a highlight it resolves to the highlight's inherited color).
    let lastRanges = [];
    let textFade = null;
    let fadeStyle = null;

    // Highlights are armed (held at the selected color) before a click or key can clear the selection,
    // so the text never flashes its own color between the selection ending and the fade starting.
    // While the selection is still there ::selection paints above them, so arming is invisible.
    let textArmed = null;

    function stopTextFade() {
      textFade?.animation.cancel();
      textFade = null;
      for (const name of textArmed ?? []) CSS.highlights.delete(name);
      textArmed = null;
      if (fadeStyle) fadeStyle.textContent = "";
    }

    function armText() {
      if (textArmed || lastRanges.length === 0 || !overlay?.classList.contains(CLASS.visible)) return;
      textArmed = buildTextHighlights(lastRanges);
    }

    // Layer, media tints and text leave together: the text fade copies the timing of the overlay's
    // own hide transition (opacity for fade, otherwise the blur/wipe transition), and all of them
    // are started in the same style update, so they share one start frame.
    function fadeOut(effect) {
      overlay.classList.remove(CLASS.visible);
      tints.classList.remove(CLASS.visible);
      void getComputedStyle(overlay).opacity;
      void getComputedStyle(tints).opacity;
      const order = effect.split(" ").includes("fade")
        ? ["opacity"]
        : ["filter", "clip-path", "-webkit-clip-path", "opacity"];
      const transitions = overlay.getAnimations?.() ?? [];
      const reference = order
        .map((property) => transitions.find((animation) => animation.transitionProperty === property))
        .find(Boolean);
      fadeText(reference?.effect?.getTiming());
      syncCovers();
    }

    function fadeText(timing) {
      const duration = Number(timing?.duration) || 0;
      if (duration <= 0) {
        lastRanges = [];
        stopTextFade();
        return;
      }
      if (!textArmed && lastRanges.length > 0) textArmed = buildTextHighlights(lastRanges);
      lastRanges = [];
      if (!textArmed?.length) return;
      textFade?.animation.cancel();
      const animation = document.documentElement.animate(
        { "--visual-selection-layer-fade": ["100%", "0%"] },
        { duration, delay: timing.delay, easing: timing.easing, fill: "backwards" },
      );
      textFade = { animation };
      animation.finished.then(() => textFade?.animation === animation && stopTextFade(), () => {});
    }

    function buildTextHighlights(ranges) {
      if (!window.CSS?.highlights || !window.Highlight) return [];
      const exclude = readConfig().exclude;
      const groups = new Map();
      let budget = 4000;
      for (const range of ranges) {
        const root = range.commonAncestorContainer;
        const nodes = [];
        if (root.nodeType === Node.TEXT_NODE) nodes.push(root);
        else {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => (range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
          });
          for (let node = walker.nextNode(); node && nodes.length < budget; node = walker.nextNode()) nodes.push(node);
        }
        budget -= nodes.length;
        for (const node of nodes) {
          const el = node.parentElement;
          if (!el || !node.data.trim() || el.closest(exclude)) continue;
          const own = getComputedStyle(el);
          const selected = own.getPropertyValue("--selection-text-color").trim();
          if (!selected || !CSS.supports("color", selected)) continue;
          const key = `${selected}|${own.color}`;
          const piece = document.createRange();
          piece.selectNodeContents(node);
          if (node === range.startContainer) piece.setStart(node, range.startOffset);
          if (node === range.endContainer) piece.setEnd(node, range.endOffset);
          if (piece.collapsed) continue;
          if (!groups.has(key)) groups.set(key, { selected, own: own.color, ranges: [] });
          groups.get(key).ranges.push(piece);
        }
        if (budget <= 0) break;
      }
      if (groups.size === 0) return [];
      if (!fadeStyle) {
        fadeStyle = document.createElement("style");
        fadeStyle.dataset.visualSelectionLayer = "fade";
        document.head.append(fadeStyle);
      }
      const names = [];
      const rules = [];
      [...groups.values()].slice(0, 32).forEach((group, index) => {
        const name = `visual-selection-layer-fade-${index}`;
        names.push(name);
        CSS.highlights.set(name, new Highlight(...group.ranges));
        rules.push(
          `::highlight(${name}) { color: color-mix(in srgb-linear, ${group.selected} var(--visual-selection-layer-fade), ${group.own}); }`,
        );
      });
      rules.push(":root { --visual-selection-layer-fade: 100%; }");
      fadeStyle.textContent = rules.join("\n");
      return names;
    }

    function sameRanges(a, b) {
      return (
        a.length === b.length &&
        a.every((range, i) => {
          try {
            return (
              range.compareBoundaryPoints(Range.START_TO_START, b[i]) === 0 &&
              range.compareBoundaryPoints(Range.END_TO_END, b[i]) === 0
            );
          } catch {
            return false;
          }
        })
      );
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
      const ctx = createContext(config, parseFloat(sourceStyle.getPropertyValue("--selection-z-index")) || 0);
      const pieces = field ? [fieldRects(field, ctx)] : ranges.map((range) => collectRects(range, ctx));
      // A render of the unchanged selection (pointerdown on it, scroll, resize) keeps the armed highlights.
      if (textFade || !sameRanges(ranges, lastRanges)) stopTextFade();
      lastRanges = ranges.map((range) => range.cloneRange());
      const radius = lengthVar(sourceStyle, "--selection-radius", 9);
      const jog = lengthVar(sourceStyle, "--selection-jog", 6);
      const traceShape = (piece) => traceUnion(mergeNearby(buildRects(piece, geometry), geometry.merge));
      const coverRects = new Map();
      for (const piece of pieces) {
        for (const [el, list] of piece.covers) {
          if (!coverRects.has(el)) coverRects.set(el, []);
          coverRects.get(el).push(...list);
        }
      }
      const shapes = new Map();
      for (const [el, list] of coverRects) {
        const coverLoops = traceShape({ text: list, boxes: [] });
        if (coverLoops.length === 0) continue;
        const rect = el.getBoundingClientRect();
        const round = (value) => Math.round(value * 100) / 100;
        shapes.set(el, {
          d: roundedPath(coverLoops.map((loop) => loop.map(([x, y]) => [x - rect.left, y - rect.top])), radius, jog),
          width: round(rect.width),
          height: round(rect.height),
          color: getComputedStyle(el).getPropertyValue("--selection-color").trim() || "Highlight",
        });
      }
      const loops = traceShape({
        text: pieces.flatMap((piece) => piece.text),
        boxes: pieces.flatMap((piece) => piece.boxes),
      });
      if (loops.length === 0 && shapes.size === 0) {
        hide();
        return;
      }

      const xs = loops.flat().map((p) => p[0]);
      const ys = loops.flat().map((p) => p[1]);
      const left = xs.length ? Math.min(...xs) : 0;
      const top = ys.length ? Math.min(...ys) : 0;
      const width = xs.length ? Math.max(...xs) - left : 0;
      const height = ys.length ? Math.max(...ys) - top : 0;
      const local = loops.map((loop) => loop.map(([x, y]) => [x - left, y - top]));
      const d = roundedPath(local, radius, jog) || "M0 0Z";
      shapeLoops = local;
      // The layer sits at the document origin, so page scrolling moves the overlay natively.
      const origin = layer.getBoundingClientRect();

      // Appearing from nothing or following a scroll/resize should not morph from stale geometry.
      const appearing = !overlay.classList.contains(CLASS.visible) || hideToken !== 0;
      const snap = instant || !overlay.classList.contains(CLASS.visible);
      hideToken = 0;
      box = { left, top, width, height };
      // A snap applies the new effect's hidden state and geometry with transitions off, so the show
      // animation always starts from the current effect instead of the previous one.
      if (snap) {
        overlay.classList.add(CLASS.instant);
        tints.classList.add(CLASS.instant);
      }
      applyTheme(sourceStyle, config.rootStyle);
      const x = left - origin.left;
      const y = top - origin.top;
      Object.assign(overlay.style, {
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
      let anchor = sourceStyle.getPropertyValue("--selection-image-anchor").trim() || "auto";
      if (anchor === "auto") {
        anchor = sourceStyle.getPropertyValue("--selection-image-repeat").trim() === "no-repeat" ? "selection" : "page";
      }
      const fixedImage = sourceStyle.getPropertyValue("--selection-image-attachment").trim() === "fixed";
      fill.toggleAttribute("data-image-fixed", fixedImage);
      if (fixedImage) {
        fill.style.setProperty("--visual-selection-layer-viewport-x", `${-left}px`);
        fill.style.setProperty("--visual-selection-layer-viewport-y", `${-top}px`);
        fill.style.setProperty("--visual-selection-layer-viewport-width", `${window.innerWidth}px`);
        fill.style.setProperty("--visual-selection-layer-viewport-height", `${window.innerHeight}px`);
      }
      if (anchor === "page" && !fixedImage) fill.style.backgroundPosition = `${-x}px ${-y}px`;
      else fill.style.removeProperty("background-position");
      setShape(d, Math.round(width * 100) / 100, Math.round(height * 100) / 100);
      renderTints(pieces, sourceStyle, origin);
      if (snap) {
        void getComputedStyle(fill).clipPath;
        void overlay.offsetWidth;
        void getComputedStyle(tints).opacity;
        overlay.classList.remove(CLASS.instant);
        tints.classList.remove(CLASS.instant);
      }
      overlay.classList.add(CLASS.visible);
      tints.classList.add(CLASS.visible);
      setCovers(shapes);
      emit(appearing ? "show" : "update");
    }

    let frame = 0;
    let pendingInstant = false;
    let shapeLoops = [];
    function scheduleRender(instant = false) {
      pendingInstant = pendingInstant || instant === true;
      if (!frame) frame = requestAnimationFrame(render);
    }
    const scheduleInstant = () => scheduleRender(true);

    // Same-origin iframes get their own engine themed like this page (scope and exclude stay their own).
    // Cross-origin frames can't be reached and stay tinted boxes; frames with their own engine are left alone.
    const frames = new Map();
    const INHERITED_VARS = [...BASE_CSS.matchAll(/(--selection-[\w-]+):/g)]
      .map((match) => match[1])
      .filter((name) => name !== "--selection-scope" && name !== "--selection-exclude")
      .concat("--selection-text-color", "--selection-field-color", "--selection-field-text-color");

    function frameTheme() {
      const style = getComputedStyle(document.documentElement);
      const declarations = INHERITED_VARS
        .map((name) => [name, style.getPropertyValue(name).trim()])
        .filter(([, value]) => value)
        .map(([name, value]) => `${name}: ${value};`)
        .join(" ");
      return `:root { ${declarations} }`;
    }

    function attachFrame(iframe) {
      if (!mounted) return;
      let win;
      let doc;
      try {
        win = iframe.contentWindow;
        doc = win?.document;
      } catch {
        return;
      }
      if (!doc || frames.get(iframe)?.doc === doc) return;
      detachFrame(iframe);
      // The initial about:blank of a frame that is still navigating gets replaced; its load attaches.
      if (doc.readyState === "loading" || !doc.documentElement) return;
      if (doc.URL === "about:blank" && (iframe.hasAttribute("src") || iframe.hasAttribute("srcdoc"))) return;
      if (iframe.closest(readConfig().exclude)) return;
      if (win.VisualSelectionLayer && !installed.has(win.VisualSelectionLayer)) return;
      // Prepended with :root specificity: above the frame's zero-specificity defaults, below its own rules.
      const theme = doc.createElement("style");
      theme.dataset.visualSelectionLayerTheme = "";
      theme.textContent = frameTheme();
      (doc.head ?? doc.documentElement).prepend(theme);
      const frameApi = install(win);
      installed.add(frameApi);
      win.VisualSelectionLayer = frameApi;
      frames.set(iframe, { win, doc, api: frameApi, theme });
    }

    function detachFrame(iframe) {
      const entry = frames.get(iframe);
      if (!entry) return;
      frames.delete(iframe);
      try {
        entry.api.disable();
        entry.theme.remove();
        if (entry.win.VisualSelectionLayer === entry.api) delete entry.win.VisualSelectionLayer;
      } catch {
        // The frame's document is already gone.
      }
    }

    function syncFrames() {
      if (!mounted) return;
      const theme = frameTheme();
      for (const [iframe, entry] of frames) {
        if (!iframe.isConnected) detachFrame(iframe);
        else if (entry.theme.textContent !== theme) entry.theme.textContent = theme;
      }
      document.querySelectorAll("iframe").forEach(attachFrame);
    }

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
      // Selection changes jump straight to the new shape (select all, double/triple click, context menu,
      // programmatic, field edits). Only a keyboard extension (Shift + arrow/Home/End/Page keys) morphs,
      // since it grows the current selection step by step; variable/class updates morph too.
      // While a new selection is being dragged out the shape follows the pointer without morphing.
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
        armText();
      }, { capture: true, signal });
      let extending = false;
      let extendTimer = 0;
      document.addEventListener("keydown", (event) => {
        touch = false;
        armText();
        if (!event.shiftKey || !EXTEND_KEYS.has(event.key)) return;
        extending = true;
        clearTimeout(extendTimer);
        extendTimer = setTimeout(() => { extending = false; }, 300);
      }, { capture: true, signal });
      signal.addEventListener("abort", () => clearTimeout(extendTimer));
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
        document.addEventListener(type, () => scheduleRender(dragging || touch || !extending), { capture: true, signal });
      }
      window.addEventListener("resize", scheduleInstant, { signal });
      window.addEventListener("scroll", scheduleInstant, { capture: true, passive: true, signal });
      window.visualViewport?.addEventListener("resize", scheduleInstant, { signal });
      // Images, video posters, and fonts change layout after load.
      document.addEventListener("load", (event) => {
        if (event.target.tagName === "IFRAME") attachFrame(event.target);
        scheduleInstant();
      }, { capture: true, signal });
      document.fonts?.ready.then(() => mounted && scheduleInstant());
      if (window.ResizeObserver) {
        const resize = new ResizeObserver(scheduleInstant);
        resize.observe(document.body);
        observers.push(resize);
      }
      // Variables or classes changed on <html>/<body> (themes, scope, effect) apply immediately.
      for (const target of [document.documentElement, document.body]) {
        const mutation = new MutationObserver(() => {
          scheduleRender();
          syncFrames();
        });
        mutation.observe(target, { attributes: true, attributeFilter: ["style", "class"] });
        observers.push(mutation);
      }

      teardown = () => {
        [...frames.keys()].forEach(detachFrame);
        controller.abort();
        observers.forEach((observer) => observer.disconnect());
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        pendingInstant = false;
        document.documentElement.classList.remove(CLASS.active);
        document.querySelectorAll("style[data-visual-selection-layer]").forEach((style) => style.remove());
        stopTextFade();
        clearCovers();
        layer?.remove();
        layer = overlay = fill = tints = rulesStyle = fadeStyle = null;
        lastRanges = [];
        rulesKey = "";
        lastSource = null;
        hideToken = 0;
        box = null;
      };
      scheduleRender(true);
      syncFrames();
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

    const api = {
      refresh: () => scheduleRender(),
      enable: () => setEnabled(true),
      disable: () => setEnabled(false),
      get enabled() {
        return isActive();
      },
      on(type, fn) {
        if (!listeners[type]) throw new TypeError(`visual-selection-layer: unknown event "${type}"`);
        listeners[type].add(fn);
        return () => listeners[type].delete(fn);
      },
    };

    if (document.body) init();
    else document.addEventListener("DOMContentLoaded", init, { once: true });
    return api;
  }
})();
