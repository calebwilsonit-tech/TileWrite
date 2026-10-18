# The Asset Hub

The **Hub** panel (bottom dock) is a window onto a community **Asset Hub**: a server where people share packs of tiles, props, characters, structures, interface pieces, behaviours and sounds. Everything is free to take; the author decides under which licence. The hub itself is a small program you can run on your own computer or host for a community (see [HUB_HOSTING.md](HUB_HOSTING.md)). Tilewright does not ship with an address for a public hub and never contacts one by itself: the Hub panel only talks to the address you type.

## Taking something
1. Type the hub's address (for a hub on your own computer: `http://localhost:8787`) and press **Connect**. Addresses on the internet must start with `https://`.
2. Search by words, kind, licence, or sort by newest, best rated or most taken. Each card shows the author, the licence, the rating and how many times it was taken.
3. Click a card, read the description and the licence, then **Add to my library**. It is saved in your personal library with where it came from ([asset-library.md](asset-library.md)); from there **Add to project** installs it as a link or a copy, with the same clash handling as any pack.
4. Rate it (sign in first) or **Report** it with a few words about what is wrong.

## Licences
Every pack on the hub has a licence, chosen when it was saved to the author's library:

| Licence | What it means for your game |
| --- | --- |
| CC0 | Public domain: use it any way you like. |
| CC-BY | Use it in any game, including a sold one, and name the author. |
| CC-BY-NC | Name the author, and do not use it in a game that is sold. |
| Free for any game | The author says you may use it in any game. |
| Custom | Read the description for the author's own terms. |

### Credits for your game
Whatever you add from a hub keeps its author and licence in `assets/library-links.json`. When you **export** the game, Tilewright writes a **CREDITS.txt** beside the program: one line for each thing that has an author, with the licence and where it came from, and the licence texts' addresses. The export dialog also warns you when something is CC-BY-NC (not for sale) or came with no licence.

## Packs with code
A pack that contains scripts or plugins is marked **HAS CODE** everywhere. On the hub it is **held back until a moderator approves it**: its publisher can see it waiting, nobody else can. It is limited to 256 KB of code per pack so a person can actually read it. In the Hub panel you must tick *I understand it contains code* before it is added to your library, and installing it into a project needs a second yes in the Library panel. Packs without code (pictures, tile data, structures, tables, interface pieces, sounds) cannot run anything.

## Sharing
Sign in (or make an account), choose an item from your library, add a note about what changed, press **Publish**. The author shown is your account name, whatever the file says. Publishing the same name again makes a new version. You can publish up to ten times an hour. Items with code say they are waiting for a moderator; refused items show the moderator's reason under **your uploads**.

## Reports and moderation
Anyone signed in can report an item. When three different people report the same item it is hidden until a moderator has looked. A moderator (someone with the hub's secret token) sees the waiting packs and the open reports, and can approve, refuse with a reason, or remove an item. See [HUB_HOSTING.md](HUB_HOSTING.md) for how.

## What is designed but not built
- **Payments and paid items**: not built. Everything on the hub is free.
- **Email, password reset and verified accounts**: accounts are a name and a password kept as a salted hash; there is no email. A hub that needs them should put a single sign-on service in front.
- **Comments, collections, followers, download statistics over time, a web page for browsing**: the API is enough to build them; none are written.
- **Large hubs**: the lists are kept in one JSON file; a hub with many thousands of items needs a database behind the same API.
- **Automatic checks of what a picture shows** (stolen art, offensive pictures): moderation relies on reports and on people.

## For programmers: the hub's API
`GET /api/v1/health`, `POST /accounts`, `POST /login`, `GET /items?q=&kind=&tag=&licence=&sort=`, `GET /items/:id`, `GET /items/:id/pack`, `POST /items`, `POST /items/:id/rate`, `POST /items/:id/report`, `DELETE /items/:id`, `GET /mine`, and for moderators `GET /admin/queue`, `POST /admin/items/:id/approve`, `POST /admin/items/:id/reject`, `POST /admin/reports/:id/dismiss`. Requests carry `Authorization: Bearer <token>`. The editor makes the requests from its main process (the pages themselves may not reach the internet), allows plain `http://` only for this computer, and limits what comes back to 24 MB of text.

## Tested by
`packages/hub-server/src/hub.test.ts` (accounts, publishing, search, code packs held back, ratings, reports, limits, the HTTP server), `packages/editor/src/renderer/library/hub.test.ts` (the editor's client against the real server), `packages/exporter/src/exporter.test.ts` (credits), `e2e/p2-tiles-showcase.spec.ts`.
