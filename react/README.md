# setexty · React + GSAP

`setexty.js` is a copy of the engine in the parent folder; keep the two in sync.

```jsx
import gsap from "gsap"; // optional
import { Setexty, SetextyScope } from "./setexty/react";

<Setexty vars={{ color: "#d4f53c", radius: "9px" }} />            // CSS effects (--selection-effect)
<Setexty gsap={gsap} effect="pop" />                              // GSAP: pop | rise | stretch | { show, hide }
<SetextyScope as="aside" vars={{ color: "#ffd7a6" }}>…</SetextyScope> // scoped look
<SetextyScope ignore>…</SetextyScope>                               // native selection
```

Hooks: `useSetexty({ enabled, vars, onShow, onUpdate, onHide })`, `useSetextyGsap(gsap, effect)`, `useCssVars(vars, ref?)`.
`vars` keys map to `--selection-<key>` (`"pad-x"` → `--selection-pad-x`).

Without React: `setextyGsap(gsap, "rise")` after loading `setexty.js`; it returns a dispose function.
Custom effect: `{ show: (gsap, fill) => tween, hide: (gsap, fill) => tween }`. Return the hide tween: the layer stays until it finishes.

SSR-safe: the engine loads in an effect. Mount `<Setexty />` once per page.
