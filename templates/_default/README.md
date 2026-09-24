# Templates

Each brand has a folder `templates/<slug>/`. `add-brand.ts` copies `_default/` for a new brand.

Placeholders use `{{name}}`. Built-in values:

- `{{width}}`, `{{height}}`, `{{format}}` (`square` or `story`)
- `{{brand.name}}`, `{{brand.logo}}`, `{{brand.font_heading}}`, `{{brand.font_body}}`, `{{brand.google_fonts_url}}`
- `{{brand.colour.<key>}}` for every key in `brands.brand_assets.colours`

Any other placeholder is a text slot Claude fills (`headline`, `sub`, `proof`, `cta`). Files starting with `_` are ignored. `photo-overlay.html` is used by the fal.ai route and must keep the `photo`, `headline` and `sub` slots.
