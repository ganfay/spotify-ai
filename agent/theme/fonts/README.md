# Fonts of the themes

All are under the SIL Open Font License 1.1 (licence texts next to this file), taken
from the Google Fonts repository and cut down to the letters the theme needs:

| File | Font | Cut to |
|---|---|---|
| `GrenzeGotisch-SemiBold.woff2` | Grenze Gotisch (Omnibus-Type), weight 600 of the variable font | Latin, Latin-1, Latin Extended-A, punctuation |
| `RuslanDisplay-Cyrillic.woff2` | Ruslan Display (Oleg Snarsky) | Cyrillic (Russian, Ukrainian) and № |
| `Manrope-Bold.woff2` (Glass) | Manrope (Mikhail Sharanda), weight 700 of the variable font | Latin, Latin-1, Latin Extended-A, Cyrillic, punctuation |
| `RussoOne-Regular.woff2` (Neon) | Russo One (Jovanny Lemonad) | Latin, Latin-1, Latin Extended-A, Cyrillic, punctuation |
| `RubikGlitch-Regular.woff2` (Ghoul) | Rubik Glitch (Rubik Filtered project, NaN) | Latin, Latin-1, Latin Extended-A, Cyrillic, punctuation |

The build (`agent/build.mjs`) puts them into the theme's `user.css` as data URIs,
because a Spicetify theme cannot ship separate font files without overwriting
Spotify's own assets. Together they add about 270 KB to that stylesheet (Rubik Glitch alone is 120 KB: its broken letters have many outlines).

Made with fontTools: `fonttools varLib.instancer GrenzeGotisch[wght].ttf wght=600`,
then `pyftsubset … --flavor=woff2`.
