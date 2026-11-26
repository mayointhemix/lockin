# Lock In

Gym accountability app: post a photo or video at the gym 5 days a week or pay up. Bonus goals earn points; the top scorer among people who hit their gym days wins the weekly pot.

## Install on a server (Ubuntu/Debian)

1. Point a subdomain (an A record) at the server's IP.
2. On the server:

```bash
git clone <this repo> lockin && cd lockin && sudo ./deploy/install.sh lockin.yourdomain.com
```

The installer sets up Node, the app as a service, HTTPS (uses nginx if it is already there, otherwise Caddy), and nightly backups to `/var/backups/lockin`. Re-run it after a `git pull` to update.

## Run locally

```bash
npm install && npm start
```

Then open http://localhost:3000. Run the tests with `npm test`.

Data lives in `DATA_DIR` (default `./data`): one SQLite file plus an `uploads` folder.
