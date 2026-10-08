// GSAP show/hide effects for visual-selection-layer. Framework-free: works with React (see components.js) or plain JS.
// GSAP is passed in, never imported, so it stays an optional peer dependency.
//
//   import gsap from "gsap";
//   const dispose = visualSelectionLayerGsap(gsap, "pop");      // or a custom { show, hide }
//
// Each effect animates the overlay's fill element. The engine keeps the layer visible until the
// tween returned by `hide` completes, and keeps morphing the shape between selections with CSS.

// Only these props are cleared after a tween: the engine owns the fill's clip-path/mask.
const CLEAR = "opacity,transform,filter";

// EDIT: GSAP presets. show/hide receive (gsap, fill) and return a tween.
export const GSAP_EFFECTS = {
  pop: {
    show: (gsap, el) =>
      gsap.fromTo(el, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(2.2)", clearProps: CLEAR }),
    hide: (gsap, el) => gsap.to(el, { opacity: 0, scale: 0.96, duration: 0.18, ease: "power1.in" }),
  },
  rise: {
    show: (gsap, el) =>
      gsap.fromTo(el, { opacity: 0, y: 8, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.35, ease: "power3.out", clearProps: CLEAR }),
    hide: (gsap, el) => gsap.to(el, { opacity: 0, y: -4, duration: 0.2, ease: "power2.in" }),
  },
  stretch: {
    show: (gsap, el) =>
      gsap.fromTo(el, { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.45, ease: "expo.out", clearProps: CLEAR }),
    hide: (gsap, el) => gsap.to(el, { scaleX: 0, transformOrigin: "100% 50%", duration: 0.25, ease: "expo.in" }),
  },
};

/**
 * Plays GSAP effects when the Visual selection layer highlight appears and disappears.
 * @param gsap    the gsap instance
 * @param effect  preset name (pop | rise | stretch) or { show(gsap, fill), hide(gsap, fill) }
 * @param visualSelectionLayer  the engine API (default: window.VisualSelectionLayer)
 * @returns dispose(): removes the handlers and restores --selection-effect
 */
export function visualSelectionLayerGsap(gsap, effect = "pop", visualSelectionLayer = window.VisualSelectionLayer) {
  const fx = typeof effect === "string" ? GSAP_EFFECTS[effect] : effect;
  if (!gsap || !fx || !visualSelectionLayer) throw new TypeError("visualSelectionLayerGsap: needs gsap, an effect, and window.VisualSelectionLayer");
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  // CSS show/hide effects would play on top of the tweens, so they are switched off meanwhile.
  const root = document.documentElement.style;
  const previous = root.getPropertyValue("--selection-effect");
  root.setProperty("--selection-effect", "none");

  const play = (step) => ({ fill }) => {
    gsap.killTweensOf(fill);
    if (!reduced?.matches && fx[step]) return fx[step](gsap, fill);
    gsap.set(fill, { clearProps: CLEAR });
  };
  const offs = [visualSelectionLayer.on("show", play("show")), visualSelectionLayer.on("hide", play("hide"))];

  return () => {
    offs.forEach((off) => off());
    if (previous) root.setProperty("--selection-effect", previous);
    else root.removeProperty("--selection-effect");
  };
}
