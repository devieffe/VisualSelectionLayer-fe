# VisualSelectionLayer

One smooth, padded, rounded layer for page selection. No dependencies or build step.

```html
<link rel="stylesheet" href="https://unpkg.com/vsl@0.1.0/VisualSelectionLayer.css">
<script src="https://unpkg.com/vsl@0.1.0/VisualSelectionLayer.js"></script>
```

The stylesheet provides optional configuration; the script includes its default styles.
Configure the layer with `--selection-*` CSS variables:

```css
:root {
  --selection-color: #d4f53c;
  --selection-radius: 9px;
  --selection-effect: fade;
}
```

See [the project website](https://devieffe.github.io/vsl/) and
[source repository](https://github.com/devieffe/vsl) for the demo and React integration.
This npm package includes only the standalone engine, configuration stylesheet and documentation.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md): free for personal, educational and other noncommercial use.
