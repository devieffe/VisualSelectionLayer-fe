# Visual selection layer · React + GSAP

```bash
npm i react
```

`VisualSelectionLayer.js` is a copy of `../html/VisualSelectionLayer.js`; keep the two in sync.
Copy this folder from the repository into your project. The standalone `vsl` npm
package does not include the React integration.

```jsx
import gsap from "gsap"; // optional
import { VisualSelectionLayer, VisualSelectionLayerScope } from "./react/index.js";

<VisualSelectionLayer vars={{ color: "#d4f53c", radius: "9px" }} />            // CSS effects (--selection-effect)
<VisualSelectionLayer gsap={gsap} effect="pop" />                              // GSAP: pop | rise | stretch | { show, hide }
<VisualSelectionLayerScope as="aside" vars={{ color: "#ffd7a6" }}>…</VisualSelectionLayerScope> // scoped look
<VisualSelectionLayerScope ignore>…</VisualSelectionLayerScope>                               // native selection
```

Hooks: `useVisualSelectionLayer({ enabled, vars, onShow, onUpdate, onHide })`, `useVisualSelectionLayerGsap(gsap, effect)`, `useCssVars(vars, ref?)`.
`vars` keys map to `--selection-<key>` (`"pad-x"` → `--selection-pad-x`).

Without React: `visualSelectionLayerGsap(gsap, "rise")` after loading `VisualSelectionLayer.js`; it returns a dispose function.
Custom effect: `{ show: (gsap, fill) => tween, hide: (gsap, fill) => tween }`. Return the hide tween: the layer stays until it finishes.

SSR-safe: the engine loads in an effect. Mount `<VisualSelectionLayer />` once per page.


## License

[PolyForm Noncommercial 1.0.0](LICENSE.md): free for personal, educational and other noncommercial use. For commercial use, contact [@devieffe](https://github.com/devieffe).
