# Font of the Glass theme

| File | Font | Cut to |
|---|---|---|
| `Manrope-Bold.woff2` | Manrope (Mikhail Sharanda), weight 700 of the variable font | Latin, Latin-1, Latin Extended-A, Cyrillic, punctuation |

SIL Open Font License 1.1 (licence text next to this file), taken from the Google Fonts
repository. The build (`agent/build.mjs`) puts it into the theme's `user.css` as a data URI,
because a Spicetify theme cannot ship separate font files without overwriting Spotify's own
assets. It adds about 30 KB to that stylesheet.

Made with fontTools: `fonttools varLib.instancer Manrope[wght].ttf wght=700`, then
`pyftsubset … --unicodes="U+0020-007E,U+00A0-017F,U+0400-045F,U+0490-0491,U+2010-2027,U+2030-205E,U+2116,U+20AC" --layout-features='*' --flavor=woff2`.

Noir, Neon and Ghoul (and their fonts) were removed on 2026-11-28 (decision 33).
