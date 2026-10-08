// © 2026 Dev Ieffe. All rights reserved.
import { toVar, useSetexty, useSetextyGsap } from "./useSetexty.js";

/**
 * Turns the setexty highlight on for the whole page. Renders nothing; mount it once.
 *   <Setexty vars={{ color: "#d4f53c" }} />
 *   <Setexty gsap={gsap} effect="pop" />   // GSAP show/hide instead of the CSS effect
 */
export function Setexty({ gsap, effect = "pop", ...options }) {
  useSetexty(options);
  useSetextyGsap(gsap, effect);
  return null;
}

/**
 * Scopes selection styling to its children. `vars` become inline CSS variables
 * ({ color: "red" } -> --selection-color: red); `ignore` keeps the native selection there.
 *   <SetextyScope as="aside" vars={{ color: "#9cf" }}>…</SetextyScope>
 */
export function SetextyScope({ as: Tag = "div", vars, ignore = false, className, style, ...props }) {
  const custom = Object.fromEntries(Object.entries(vars ?? {}).map(([name, value]) => [toVar(name), value]));
  const classes = [ignore ? "setexty-ignore" : "setexty-scope", className].filter(Boolean).join(" ");
  return <Tag className={classes} style={{ ...custom, ...style }} {...props} />;
}
