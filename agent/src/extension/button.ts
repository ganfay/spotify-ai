// The only code that runs when Spotify starts (decision 9: idle = zero work).
// It waits until the top bar exists, adds one button and stops.
// No timers stay alive, nothing is observed, nothing else is loaded.

declare const Spicetify: any;

const ROUTE = "/ai-playlists";
const ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6L8 1z"/></svg>';

(function start(attempt = 0): void {
  if (!(globalThis as any).Spicetify?.Topbar?.Button || !Spicetify?.Platform?.History) {
    // Spotify is still starting. Try again a few times, then give up quietly.
    if (attempt < 60) setTimeout(() => start(attempt + 1), 500);
    return;
  }
  new Spicetify.Topbar.Button("AI Playlists", ICON, () => Spicetify.Platform.History.push(ROUTE));
})();
