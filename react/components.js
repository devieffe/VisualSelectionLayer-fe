import { createElement } from "react";
import { toVar, useVisualSelectionLayer, useVisualSelectionLayerGsap } from "./useVisualSelectionLayer.js";

/**
 * Turns the Visual selection layer highlight on for the whole page. Renders nothing; mount it once.
 *   <VisualSelectionLayer vars={{ color: "#d4f53c" }} />
 *   <VisualSelectionLayer gsap={gsap} effect="pop" />   // GSAP show/hide instead of the CSS effect
 */
export function VisualSelectionLayer({ gsap, effect = "pop", ...options }) {
  useVisualSelectionLayer(options);
  useVisualSelectionLayerGsap(gsap, effect);
  return null;
}

/**
 * Scopes selection styling to its children. `vars` become inline CSS variables
 * ({ color: "red" } -> --selection-color: red); `ignore` keeps the native selection there.
 *   <VisualSelectionLayerScope as="aside" vars={{ color: "#9cf" }}>…</VisualSelectionLayerScope>
 */
export function VisualSelectionLayerScope({ as: Tag = "div", vars, ignore = false, className, style, ...props }) {
  const custom = Object.fromEntries(Object.entries(vars ?? {}).map(([name, value]) => [toVar(name), value]));
  const classes = [ignore ? "visual-selection-layer-ignore" : "visual-selection-layer-scope", className].filter(Boolean).join(" ");
  return createElement(Tag, { className: classes, style: { ...custom, ...style }, ...props });
}
