# Visual selection layer

Enhanced page content selection

<p align="center"><img src="demo.gif" alt="Visual selection layer demo: selections merging into one rounded layer" width="480"></p>

Native text selection stacks a separate highlight for every line and element, so you get seams, overlaps and weird corners. Visual selection layer paints the whole selection as **one** smooth layer instead, with padding and rounded corners everywhere, even where lines meet. It also covers images, small print, inline code and form fields.

No dependencies, no build step, and your HTML stays the same.

## Install (HTML)

1. Copy `html/VisualSelectionLayer.js` into your project.
2. Add it to your page:

   ```html
   <script src="VisualSelectionLayer.js"></script>
   ```

CSS: `html/VisualSelectionLayer.css`

After publishing the npm package, the script is also available through UNPKG:

```html
<link rel="stylesheet" href="https://unpkg.com/vsl@0.1.0/VisualSelectionLayer.css">
<script src="https://unpkg.com/vsl@0.1.0/VisualSelectionLayer.js"></script>
```

```css
:root {
  --selection-color: #d4f53c;
  --selection-radius: 9px;
  --selection-pad-x: 5px;
  --selection-pad-y: 3px;
  --selection-effect: fade; /* fade | blur | wipe | none */
}
```

Vars and options: `html/VisualSelectionLayer.js`.

### Handy tips

- Add `visual-selection-layer-ignore` to an element to keep the native selection there.
- Put `--selection-*` variables on any class to give that area its own look.
- JS API: `VisualSelectionLayer.enable()`, `VisualSelectionLayer.disable()`, `VisualSelectionLayer.refresh()`, and `VisualSelectionLayer.on("show" | "update" | "hide", fn)`.

## Install (React)

```bash
npm i react
```

```jsx
import { VisualSelectionLayer } from "./react/index.js";

<VisualSelectionLayer vars={{ color: "#d4f53c", radius: "9px" }} />
```

### With GSAP

```bash
npm i gsap
```

```jsx
import gsap from "gsap";
import { VisualSelectionLayer } from "./react/index.js";

<VisualSelectionLayer gsap={gsap} effect="pop" /> // pop | rise | stretch
```

## Browsers

Recent Chrome, Edge, Firefox and Safari. 

## Publishing to npm / UNPKG

Publish from `html/`. The package includes `VisualSelectionLayer.js` and
`VisualSelectionLayer.css` at its root, plus the package metadata, README and license.
The engine files are published directly, without generated root copies.
Demo files and the `react/` and `codepen/` folders are not published.
For React integration, copy the repository's `react/` folder into your project;
it is not included in the `vsl` npm package.

```bash
cd html
npm pack --dry-run
npm login
npm publish --access public
```

UNPKG serves the published npm files automatically. Versioned file URLs:

- `https://unpkg.com/vsl@0.1.0/VisualSelectionLayer.js`
- `https://unpkg.com/vsl@0.1.0/VisualSelectionLayer.css`

Increase the version in `html/package.json` before publishing subsequent releases.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md): free for personal, educational and other noncommercial use.
