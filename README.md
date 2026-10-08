# Enhanced page content selection

<p align="center"><img src="demo.gif" alt="Visual selection layer demo: selections merging into one rounded layer" width="480"></p>

Native text selection stacks a separate highlight for every line and element, so you get seams, overlaps and weird corners. Visual selection layer paints the whole selection as **one** smooth layer instead, with padding and rounded corners everywhere, even where lines meet. It also covers images, small print, inline code and form fields.

No dependencies, no build step, and your HTML stays the same.

## Try it

Open `index.html` in a browser and select stuff. The toolbar at the top lets you play with the fill, effect, merge, radius and padding.

## Install (plain HTML)

1. Copy `visual-selection-layer.js` into your project.
2. Add it to your page:

   ```html
   <script src="visual-selection-layer.js"></script>
   ```

That's it. It runs automatically on everything inside `<body>`.

Want your own look? Copy `visual-selection-layer.css` too (or just the bits you need) and tweak the variables:

```css
:root {
  --selection-color: #d4f53c;
  --selection-radius: 9px;
  --selection-pad-x: 5px;
  --selection-pad-y: 3px;
  --selection-effect: fade; /* fade | blur | wipe | none */
}
```

All the options are listed at the top of `visual-selection-layer.js`.

### Handy tips

- Add `visual-selection-layer-ignore` to an element to keep the native selection there.
- Put `--selection-*` variables on any class to give that area its own look (see `.selection-warm` in `visual-selection-layer.css`).
- JS API: `VisualSelectionLayer.enable()`, `VisualSelectionLayer.disable()`, `VisualSelectionLayer.refresh()`, and `VisualSelectionLayer.on("show" | "update" | "hide", fn)`.

## Install (React)

```bash
npm i visual-selection-layer-react
```

```jsx
import { VisualSelectionLayer } from "visual-selection-layer-react";

<VisualSelectionLayer vars={{ color: "#d4f53c", radius: "9px" }} />
```

### With GSAP

```bash
npm i gsap
```

```jsx
import gsap from "gsap";
import { VisualSelectionLayer } from "visual-selection-layer-react"; // or "./visual-selection-layer" if you copied the folder

<VisualSelectionLayer gsap={gsap} effect="pop" /> // pop | rise | stretch
```

You can also pass your own `{ show, hide }` animations. More in [`react/README.md`](react/README.md) and [`react/App.example.jsx`](react/App.example.jsx).

## What's in here

- `visual-selection-layer.js`: the engine. This is the only file you actually need.
- `visual-selection-layer.css`: the selection look (CSS variables).
- `index.html`, `page.*`, `toolbar.*`: the demo page and its toolbar.
- `react/`: React components, hooks and GSAP effects (the `visual-selection-layer-react` npm package).

Browsers: recent Chrome, Edge, Firefox and Safari. In forced-colors (high contrast) mode it steps aside and the native selection comes back.


## License

[PolyForm Noncommercial 1.0.0](LICENSE.md): free for personal, educational and other noncommercial use.
