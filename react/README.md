# Visual selection layer · React + GSAP

```bash
npm i react
```

Copy **one file** into your project: `VisualSelectionLayer.js` for CSS effects,
or `VisualSelectionLayerGsap.js` for GSAP effects. Each includes the selection
engine and React lifecycle logic, with no local imports. Mount only one version per page.

```jsx
import VisualSelectionLayer, { VisualSelectionLayerScope } from "./VisualSelectionLayer.js";

<VisualSelectionLayer vars={{ color: "#d4f53c", radius: "9px" }} />            // CSS effects (--selection-effect)
<VisualSelectionLayerScope as="aside" vars={{ color: "#ffd7a6" }}>…</VisualSelectionLayerScope> // scoped look
<VisualSelectionLayerScope ignore>…</VisualSelectionLayerScope>                               // native selection
```

```jsx
import gsap from "gsap";
import VisualSelectionLayerGsap from "./VisualSelectionLayerGsap.js";

<VisualSelectionLayerGsap gsap={gsap} effect="pop" /> // pop | rise | stretch | { show, hide }
```

The packaged distribution provides `vsl/react` (the standard component),
`vsl/react/VisualSelectionLayer`, and `vsl/react/VisualSelectionLayerGsap` entry points.

Hooks: `useVisualSelectionLayer({ enabled, vars, onShow, onUpdate, onHide })`, `useVisualSelectionLayerGsap(gsap, effect)`, `useCssVars(vars, ref?)`.
`vars` keys map to `--selection-<key>` (`"pad-x"` → `--selection-pad-x`).

The GSAP file also exports `visualSelectionLayerGsap(gsap, "rise", engine)`, a
low-level adapter that returns a dispose function, and `GSAP_EFFECTS`.
Custom effect: `{ show: (gsap, fill) => tween, hide: (gsap, fill) => tween }`. Return the hide tween: the layer stays until it finishes.

SSR-safe: the engine loads in an effect. Mount `<VisualSelectionLayer />` once per page.

Import components and hooks directly from the chosen file. There are no wrapper
or index files; use `VisualSelectionLayerGsap` explicitly for GSAP effects.
Both embedded engines must be synchronized with `../html/VisualSelectionLayer.js` after engine changes.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md): free for personal, educational and other noncommercial use. For commercial use, contact [@devieffe](https://github.com/devieffe).
