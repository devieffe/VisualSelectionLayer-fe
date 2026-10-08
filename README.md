# setexty

Native text selection stacks a separate highlight for every line and element, so you get seams, overlaps and weird corners. setexty paints the whole selection as **one** smooth layer instead, with padding and rounded corners everywhere, even where lines meet. It also covers images, small print, inline code and form fields.

No dependencies, no build step, and your HTML stays the same.

## Try it

Open `index.html` in a browser and select stuff. The toolbar at the top lets you play with the fill, effect, merge, radius and padding.

## Install (plain HTML)

1. Copy `setexty.js` into your project.
2. Add it to your page:

   ```html
   <script src="setexty.js"></script>
   ```

That's it. It runs automatically on everything inside `<body>`.

Want your own look? Copy `setexty.css` too (or just the bits you need) and tweak the variables:

```css
:root {
  --selection-color: #d4f53c;
  --selection-radius: 9px;
  --selection-pad-x: 5px;
  --selection-pad-y: 3px;
  --selection-effect: fade; /* fade | blur | wipe | none */
}
```

All the options are listed at the top of `setexty.js`.

### Handy bits

- Add `setexty-ignore` to an element to keep the native selection there.
- Put `--selection-*` variables on any class to give that area its own look (see `.selection-warm` in `setexty.css`).
- JS API: `Setexty.enable()`, `Setexty.disable()`, `Setexty.refresh()`, and `Setexty.on("show" | "update" | "hide", fn)`.

## Install (React)

1. Copy the `react/` folder into your app, e.g. `src/setexty/`.
2. Drop the component in once, near the root:

   ```jsx
   import { Setexty } from "./setexty";

   <Setexty vars={{ color: "#d4f53c", radius: "9px" }} />
   ```

It's safe with server rendering: the engine only loads in the browser.

### With GSAP

```bash
npm i gsap
```

```jsx
import gsap from "gsap";
import { Setexty } from "./setexty";

<Setexty gsap={gsap} effect="pop" /> // pop | rise | stretch
```

You can also pass your own `{ show, hide }` animations. More in [`react/README.md`](react/README.md) and [`react/App.example.jsx`](react/App.example.jsx).

## What's in here

- `setexty.js`: the engine. This is the only file you actually need.
- `setexty.css`: the selection look (CSS variables).
- `index.html`, `page.*`, `toolbar.*`: the demo page and its toolbar.
- `react/`: React components, hooks and GSAP effects.

Browsers: recent Chrome, Edge, Firefox and Safari. In forced-colors (high contrast) mode it steps aside and the native selection comes back.

© 2026 Dev Ieffe. All rights reserved.
