// React bindings for visual-selection-layer. SSR-safe: the engine is loaded in an effect, only in the browser.
import { useEffect, useRef } from "react";
import { visualSelectionLayerGsap } from "./visual-selection-layer-gsap.js";

let engine;
/** Loads the engine once and resolves with window.VisualSelectionLayer. */
export const loadVisualSelectionLayer = () => (engine ??= import("./visual-selection-layer.js").then(() => window.VisualSelectionLayer));

/** "color" -> "--selection-color"; names already starting with "--" are kept. */
export const toVar = (name) => (name.startsWith("--") ? name : `--selection-${name}`);

/** Applies CSS variables to an element (default :root) and restores the old values on cleanup. */
export function useCssVars(vars, target) {
  const key = JSON.stringify(vars ?? {});
  useEffect(() => {
    const style = (target?.current ?? document.documentElement).style;
    const entries = Object.entries(JSON.parse(key)).map(([name, value]) => [toVar(name), value]);
    const previous = entries.map(([name]) => [name, style.getPropertyValue(name)]);
    entries.forEach(([name, value]) => style.setProperty(name, String(value)));
    return () => previous.forEach(([name, value]) => (value ? style.setProperty(name, value) : style.removeProperty(name)));
  }, [key, target]);
}

/**
 * Mounts the engine while the component is mounted.
 * @param enabled  turn the highlight on/off (default true)
 * @param vars     selection variables for :root, e.g. { color: "#d4f53c", radius: "8px" }
 * @param onShow / onUpdate / onHide  engine events, ({ overlay, fill, box, effect }) => void | Promise
 */
export function useVisualSelectionLayer({ enabled = true, vars, onShow, onUpdate, onHide } = {}) {
  const handlers = useRef({});
  handlers.current = { show: onShow, update: onUpdate, hide: onHide };
  useCssVars(vars);

  useEffect(() => {
    let alive = true;
    let offs = [];
    loadVisualSelectionLayer().then((visualSelectionLayer) => {
      if (!alive) return;
      enabled ? visualSelectionLayer.enable() : visualSelectionLayer.disable();
      offs = ["show", "update", "hide"].map((type) => visualSelectionLayer.on(type, (detail) => handlers.current[type]?.(detail)));
    });
    return () => {
      alive = false;
      offs.forEach((off) => off());
      if (enabled) window.VisualSelectionLayer?.disable();
    };
  }, [enabled]);
}

/** Plays a GSAP preset ("pop" | "rise" | "stretch") or a custom { show, hide } on the highlight. */
export function useVisualSelectionLayerGsap(gsap, effect = "pop") {
  const custom = useRef(effect);
  custom.current = effect;
  const key = typeof effect === "string" ? effect : "custom";
  useEffect(() => {
    if (!gsap) return;
    let dispose;
    let alive = true;
    loadVisualSelectionLayer().then((visualSelectionLayer) => {
      if (!alive) return;
      const fx = typeof custom.current === "string" ? custom.current : {
        show: (...args) => custom.current.show?.(...args),
        hide: (...args) => custom.current.hide?.(...args),
      };
      dispose = visualSelectionLayerGsap(gsap, fx, visualSelectionLayer);
    });
    return () => {
      alive = false;
      dispose?.();
    };
  }, [gsap, key]);
}
