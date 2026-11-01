# Fonts

These live under `src/assets/` rather than `public/` on purpose: the Angular
builder resolves and rewrites their `url()` references relative to the emitted
stylesheet, so they keep working under the GitHub Pages repository subpath. A
`public/fonts/` copy would need an absolute `/fonts/...` URL, which 404s at
`/REPOSITORY-NAME/`.

Self-hosted because the app must work fully offline (PRODUCT_SPEC section 9); a
Google Fonts CDN reference would break the first offline load.

| File                                                         | Family                   | Source                             | Version | Licence     |
| ------------------------------------------------------------ | ------------------------ | ---------------------------------- | ------- | ----------- |
| `inter-latin-wght-normal.woff2`                              | Inter (variable 100–900) | `@fontsource-variable/inter`       | 5.3.0   | SIL OFL 1.1 |
| `inter-latin-ext-wght-normal.woff2`                          | Inter (variable 100–900) | `@fontsource-variable/inter`       | 5.3.0   | SIL OFL 1.1 |
| `ibm-plex-sans-arabic-arabic-{400,500,600,700}-normal.woff2` | IBM Plex Sans Arabic     | `@fontsource/ibm-plex-sans-arabic` | 5.3.0   | SIL OFL 1.1 |

The npm packages are **not** project dependencies: the files are committed so the
build never depends on them and the repository stays self-contained. To update:

```powershell
npm install --no-save @fontsource-variable/inter@<version> @fontsource/ibm-plex-sans-arabic@<version>
```

then copy the files listed above out of `node_modules` and update this table.

## Weight note

Inter is a variable font, so any weight in 100–900 renders exactly as requested.
IBM Plex Sans Arabic is shipped as static instances, so Arabic text snaps to the
nearest of 400/500/600/700 — the design tokens' intermediate weights (450, 550, 650) are approximated for Arabic. This is deliberate: four static Arabic faces
cost far less than the full variable Arabic file.
