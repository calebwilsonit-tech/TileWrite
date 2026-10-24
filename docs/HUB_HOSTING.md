# Running an Asset Hub

This page is for the person who wants to host a hub for a community. **Nothing here has been done for you**: Tilewright's author did not deploy a hub, rent a server, register a domain or create any account. Every step below is yours to take, and several of them cost money or need your identity. Read the whole page before you start.

## 0. Try it on your own computer (free, a minute)
```
npm install
npm run build -w @tilewright/hub-server
set HUB_ADMIN_TOKEN=a-long-random-text-of-at-least-24-characters
node packages/hub-server/dist/hub.mjs --port 8787 --data hub-data
```
(on Linux or macOS use `export HUB_ADMIN_TOKEN=...`). Then in the editor open **Hub**, type `http://localhost:8787`, **Connect**, make an account and publish something from your library. `hub-data/` holds everything (`hub.json` and `packs/`); copy that folder to back the hub up.

The hub is a single file, `dist/hub.mjs`, that needs only Node 20 or newer. Options: `--port`, `--host` (default `127.0.0.1`: only this computer), `--data` (default `./hub-data`), or the environment variables `PORT`, `HOST`, `HUB_DATA`.

## 1. Decide who it is for
- **Just you and friends, on a home network**: run it with `--host 0.0.0.0` and give friends `http://<your computer's address>:8787`. Plain http is only accepted by the editor for this computer, so for anything else you need https (step 3).
- **A public community**: you will be responsible for what is uploaded. Read steps 5 and 6 first. Consider your local laws about user-uploaded content, copyright takedown requests and children's privacy before opening sign-ups.

## 2. Get a server (costs money)
Any small Linux virtual server is enough (1 CPU, 1 GB of memory, 10 GB of disk to begin with) from a provider of your choice. You will create the account with the provider and pay them; Tilewright cannot and does not do that for you. Install Node 20 or newer on it, copy `dist/hub.mjs` to it, and create a folder for the data.

## 3. https and a name (costs a little, needs a domain)
The editor refuses plain http for any hub that is not on the same computer. Buy a domain name from a registrar, point a DNS record at your server, and put a reverse proxy in front of the hub that gets a free certificate automatically. With Caddy, a whole configuration is:
```
hub.example.com {
  reverse_proxy 127.0.0.1:8787
}
```
(nginx with certbot works too). Keep the hub itself on `127.0.0.1` so only the proxy can reach it. Set the proxy's request size limit to at least 10 MB (asset packs may be up to 8 MB).

## 4. Keep it running
Run it as a service so it restarts: a systemd unit (`ExecStart=/usr/bin/node /srv/hub/hub.mjs --data /srv/hub/data`, `Environment=HUB_ADMIN_TOKEN=...`, `Restart=always`, run as a user that is not root), or a process manager such as pm2. Put the admin token in a file only the service user can read, not in a script you share.

## 5. Moderating
The **moderator token** is the secret you set as `HUB_ADMIN_TOKEN`. Anyone who has it can approve, refuse and remove items, so give it to as few people as possible and change it if it leaks (restart the hub with a new one). Moderators work with the API (a small page for moderators is not written yet):
```
curl -H "Authorization: Bearer $TOKEN" https://hub.example.com/api/v1/admin/queue
curl -X POST -H "Authorization: Bearer $TOKEN" https://hub.example.com/api/v1/admin/items/<id>/approve
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"note\":\"It reads files it should not.\"}" https://hub.example.com/api/v1/admin/items/<id>/reject
curl -X DELETE -H "Authorization: Bearer $TOKEN" https://hub.example.com/api/v1/items/<id>
```
**Asset packs with code** never appear until approved. To review one, fetch it with the same token (`GET /items/<id>/pack`), open the `files` that end in `.ts` or `.js` (they are text, or base64 if the asset pack says so), and read them. Refuse anything you do not understand. Approving code you did not read puts every user of your hub at risk.

**Reports**: three different people reporting the same item hides it until you look. `GET /admin/queue` lists the reports; approve the item to dismiss them, refuse or remove it to act on them, or dismiss a single report with `POST /admin/reports/<id>/dismiss`.

## 6. Things to decide and do before opening to the public
- **Terms and a contact address** for takedown requests. The hub has no web page, so publish yours somewhere your community will see.
- **What licences you allow.** The list (`CC0-1.0`, `CC-BY-4.0`, `CC-BY-NC-4.0`, `free-for-any-game`, `custom`) is in `packages/hub-server/src/pack.ts`; remove one by editing it and rebuilding.
- **Limits**: 8 MB per asset pack, 400 files, 256 KB of code, 10 publishes per account per hour, 30 sign-in attempts per minute per address, three reports to hide. All are constants in `packages/hub-server/src` you can change.
- **Backups**: copy the data folder regularly. Restoring is copying it back.
- **Updates**: build the new `hub.mjs`, stop the hub, replace the file, start it. The data format is plain JSON.
- **Privacy**: the hub stores account names, salted password hashes (scrypt) and the packs. It stores no email address, no IP address and sends nothing anywhere. If you put it behind a proxy, the proxy's logs hold addresses; that is your responsibility.
- **Payments**: the hub has none and the editor has no payment code. Do not add paid items without legal and tax advice.

## 7. What is not here
No web page for browsing, no email, no password reset, no moderation page, no database, no per-user storage quota, no virus scanning of uploaded files beyond refusing code in asset packs that do not declare it. See the end of [asset-hub.md](asset-hub.md).
