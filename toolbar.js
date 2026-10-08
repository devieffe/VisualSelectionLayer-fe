// © 2026 Dev Ieffe. All rights reserved.
// Preview toolbar. The engine (setexty.js) needs none of this; each control only sets CSS variables.
// Self-contained: it touches only .toolbar, :root variables and the selection. Status messages go out
// as a "toolbar:status" event for the page to show; selection targets come from data-select.
(() => {
  const rootStyle = document.documentElement.style;
  const toolbar = document.querySelector(".toolbar");
  const $ = (selector) => toolbar.querySelector(selector);
  const say = (text) => document.dispatchEvent(new CustomEvent("toolbar:status", { detail: text }));

  // EDIT: toolbar presets. Each entry is a set of CSS variables applied to :root.
  const PRESETS = {
    fill: {
      lime: {},
      grey: { "--selection-color": "rgb(120 124 130 / 28%)" },
      // difference blend: white page turns blue, and text forced to blue first turns near-white.
      inverse: {
        "--selection-color": "rgb(245 215 5)",
        "--selection-blend": "difference",
        "--selection-text-color": "rgb(0 0 255)",
      },
      gradient: {
        "--selection-image": "linear-gradient(120deg, #a8edc1, #9fd8f5 55%, #f5c6e6)",
      },
      photo: {
        "--selection-image": 'url("https://picsum.photos/seed/setext-meadow/1200/800")',
        // Pinned to the viewport (100% x 100vh), so the photo keeps its size whatever is selected.
        "--selection-image-attachment": "fixed",
        "--selection-opacity": "0.55",
      },
      layered: {
        "--selection-image":
          'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27%3E%3Ccircle cx=%272%27 cy=%272%27 r=%271.4%27 fill=%27%2310281b%27 fill-opacity=%270.35%27/%3E%3C/svg%3E"), url("https://picsum.photos/seed/setext-dunes/1200/800")',
        "--selection-image-size": "12px 12px, cover",
        "--selection-image-repeat": "repeat, no-repeat",
        "--selection-image-attachment": "fixed",
        "--selection-opacity": "0.6",
      },
    },
    effect: {
      none: {},
      fade: { "--selection-effect": "fade" },
      blur: { "--selection-effect": "blur" },
      wipe: { "--selection-effect": "wipe" },
    },
  };

  function applyPreset(group, value) {
    const presets = PRESETS[group];
    const names = new Set(Object.values(presets).flatMap(Object.keys));
    names.forEach((name) => rootStyle.removeProperty(name));
    Object.entries(presets[value] ?? {}).forEach(([name, val]) => rootStyle.setProperty(name, val));
  }

  function replaySelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return false;
    const ranges = Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange());
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--selection-effect-duration").trim();
    const value = parseFloat(raw);
    const duration = Number.isFinite(value) ? (raw.endsWith("ms") ? value : value * 1000) : 280;
    selection.removeAllRanges();
    setTimeout(() => ranges.forEach((range) => selection.addRange(range)), duration + 150);
    return true;
  }

  // Size each dropdown to its chosen option (native selects size to their widest option).
  const sizer = document.createElement("span");
  sizer.style.cssText = "position:absolute;visibility:hidden;white-space:pre;pointer-events:none";
  toolbar.append(sizer);
  function fitSelect(select) {
    sizer.style.font = getComputedStyle(select).font;
    sizer.textContent = select.selectedOptions[0]?.textContent ?? "";
    select.style.width = `${Math.ceil(sizer.getBoundingClientRect().width) + 22}px`;
  }

  toolbar.querySelectorAll(".toolbar-preset").forEach((select) => {
    fitSelect(select);
    select.addEventListener("change", () => {
      fitSelect(select);
      applyPreset(select.dataset.group, select.value);
      say(`${select.dataset.label}: ${select.selectedOptions[0].textContent}.`);
      if (select.dataset.group === "effect") replaySelection();
    });
  });
  // Web fonts can load after the first measurement.
  document.fonts?.ready.then(() => toolbar.querySelectorAll(".toolbar-preset").forEach(fitSelect));

  // Reserve the toolbar's height (it changes when the controls wrap); see body::before in toolbar.css.
  const reserve = () => rootStyle.setProperty("--toolbar-height", `${toolbar.offsetHeight}px`);
  reserve();
  new ResizeObserver(reserve).observe(toolbar);

  // Keep the current selection when interacting with the controls.
  toolbar.addEventListener("mousedown", (event) => {
    if (event.target.closest("button, label:has([type=checkbox])")) event.preventDefault();
  });

  // Buttons with data-select select that element's contents and report data-status.
  const selectButtons = toolbar.querySelectorAll("[data-select]");
  function selectContents(button) {
    const selection = window.getSelection();
    const target = document.querySelector(button.dataset.select);
    if (!selection || !target) return;
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
    say(button.dataset.status);
  }
  selectButtons.forEach((button) => button.addEventListener("click", () => selectContents(button)));

  $(".toolbar-clear").addEventListener("click", () => {
    window.getSelection()?.removeAllRanges();
    say("Selection cleared.");
  });

  $(".toolbar-native").addEventListener("change", (event) => {
    if (event.target.checked) window.Setexty?.disable();
    else window.Setexty?.enable();
    say(event.target.checked
      ? "Native: setexty is fully off (no styles, layer, or listeners); this is the browser's own highlight."
      : "Merged highlight: one padded layer with rounded corners.");
  });

  $(".toolbar-replay").addEventListener("click", () => {
    if (!replaySelection()) return selectContents(selectButtons[0]);
    say("Replaying: hide, then show with the current effect.");
  });

  // Sliders: each sets its data-var in px (Merge joins pieces within that gap; Radius rounds corners; Padding grows the shape).
  for (const range of toolbar.querySelectorAll(".toolbar-range")) {
    const output = range.parentElement.querySelector("output");
    // --fill paints the bar black up to the knob (see the slider rules in toolbar.css).
    const paint = () => range.style.setProperty("--fill", `${((range.value - range.min) / (range.max - range.min)) * 100}%`);
    paint();
    range.addEventListener("input", () => {
      paint();
      const value = Number(range.value);
      rootStyle.setProperty(range.dataset.var, `${value}px`);
      output.textContent = `${value}px`;
      if (range.dataset.var === "--selection-merge") {
        say(`Merge: nearby pieces within ${value}px join into one shape.`);
      } else if (range.dataset.var === "--selection-pad-x") {
        // Vertical padding follows at ~0.6x so lines keep the default 5px / 3px proportion.
        rootStyle.setProperty("--selection-pad-y", `${Math.round(value * 0.6)}px`);
        say(`Padding: ${value}px sides, ${Math.round(value * 0.6)}px top and bottom.`);
      } else {
        say(`Radius: every corner rounded to ${value}px.`);
      }
    });
  }
})();
