// The page of a game exported for web browsers: the browser's door first, then the same player the desktop game runs. The player is
// loaded only once the door is in place (a plain import could run first: the bundler shares the player with the desktop page).
import './web-door';

void import('./player');
