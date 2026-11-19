// The only code of this project that runs every time Spotify starts (besides the
// ad blocker). It must cost nothing when no look is saved: one read of local
// storage for the look and two for the first-start hint, then it is done. Decision 30.

import { applyAppearance, loadAppearance } from "./appearance";
import { firstStartHint } from "./hint";

(() => {
  const look = loadAppearance();
  if (look) applyAppearance(look);
  // The Appearance page uses this for a live preview.
  (window as unknown as { __spotifyAiAppearance?: typeof applyAppearance }).__spotifyAiAppearance = applyAppearance;
  // On the first start only: point at the AI Playlists button.
  firstStartHint();
})();
