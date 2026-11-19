# Fonts of the themes

Both are under the SIL Open Font License 1.1 (licence texts next to this file), taken
from the Google Fonts repository and cut down to the letters the theme needs:

| File | Font | Cut to |
|---|---|---|
| `GrenzeGotisch-SemiBold.woff2` | Grenze Gotisch (Omnibus-Type), weight 600 of the variable font | Latin, Latin-1, Latin Extended-A, punctuation |
| `RuslanDisplay-Cyrillic.woff2` | Ruslan Display (Oleg Snarsky) | Cyrillic (Russian, Ukrainian) and № |
| `Comfortaa-Bold.woff2` (Glass) | Comfortaa (Johan Aakerlund, Cyreal), weight 700 of the variable font | Latin, Latin-1, Latin Extended-A, Cyrillic, punctuation |
| `RussoOne-Regular.woff2` (Neon) | Russo One (Jovanny Lemonad) | Latin, Latin-1, Latin Extended-A, Cyrillic, punctuation |

The build (`agent/build.mjs`) puts them into the theme's `user.css` as data URIs,
because a Spicetify theme cannot ship separate font files without overwriting
Spotify's own assets. All four add about 100 KB to that stylesheet.

Made with fontTools: `fonttools varLib.instancer GrenzeGotisch[wght].ttf wght=600`,
then `pyftsubset … --flavor=woff2`.
