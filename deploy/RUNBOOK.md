# Lock In runbook

How to ship a change, undo one, and find things on the server.

## Ship a change

1. Make the change on a branch. If you touched anything in `web/`, run `npm run build` and commit the updated `public/` with it.
2. Open a pull request and merge it into `main`.
3. From your computer:

   ```bash
   npm run deploy
   ```

That logs in to the server as the limited `lockin-deploy` user, runs the update, and then checks the live site from your computer. It ends with `Deploy OK.` or `Deploy needs attention.`

What the update does on the server, in order:

1. Backs up the database to `/var/backups/lockin/pre-<commit>.db`.
2. Pulls `main` into `/root/lockin` and copies it to `/opt/lockin`.
3. Reinstalls dependencies only if `package-lock.json` changed.
4. Restarts the `lockin` service only if server code changed. Frontend-only changes need no restart.
5. Checks the app answers. If it doesn't, it puts the previous version back and reports an error.

It never touches the web server, Docker, or any other app on the machine.

## If a deploy fails

The update rolls the code back on its own. The database is **not** rolled back, because that could throw away posts made in the meantime. Schema changes so far only add columns, so older code keeps working with a newer database.

To look at what went wrong you need a root shell (the hosting provider's web console, since root login over SSH is disabled):

```bash
journalctl -u lockin -n 80 --no-pager
```

## Restore a database backup

Only do this if data is actually damaged. As root on the server:

```bash
systemctl stop lockin
cp -a /var/lib/lockin/lockin.db /var/lib/lockin/lockin.db.before-restore
cp /var/backups/lockin/<backup file>.db /var/lib/lockin/lockin.db
chown lockin:lockin /var/lib/lockin/lockin.db
systemctl start lockin
```

Backups:
- `pre-<commit>.db` is taken before each deploy. The newest 10 are kept.
- `lockin-<date>.db` and `uploads-<date>.tgz` are taken nightly at 3am and kept for 14 days.

## Where things are on the server

| What | Where |
|---|---|
| Git checkout | `/root/lockin` |
| Running app | `/opt/lockin` |
| Database and uploads | `/var/lib/lockin` |
| Backups | `/var/backups/lockin` |
| Service | `lockin.service` (`systemctl status lockin`) |
| Port | `127.0.0.1:<PORT>`, set in `/etc/systemd/system/lockin.service` |
| Update script | `/usr/local/sbin/lockin-update` (a copy of `deploy/update.sh`) |
| Deploy user | `lockin-deploy`, sudo rule in `/etc/sudoers.d/lockin-deploy` |
| Web server config | a block between `# lockin-begin` and `# lockin-end` in `/etc/caddy/Caddyfile` |

## The deploy user

`lockin-deploy` has no password. Its key can do one thing: run the update script. It has no shell access and cannot forward ports.

- **Set it up on a new server (once, as root):** `cd /root/lockin && git pull --ff-only && bash deploy/setup-deploy-user.sh`
- **Use a different computer or key:** replace `deploy/deploy-key.pub` with the new public key, merge, and run the setup script again as root.
- **Remove it:** `userdel -r lockin-deploy; rm /etc/sudoers.d/lockin-deploy /usr/local/sbin/lockin-update`

Settings for `npm run deploy` on your computer go in `deploy/.deploy.env` (not committed). `ALSO_CHECK` lists other sites on the same server that must still answer after a deploy.

## Sharing the server with other sites

If another project owns `/etc/caddy/Caddyfile` and overwrites it when it deploys, the Lock In block will disappear and the site will stop loading even though the app is running. Add this block to that project's own Caddyfile source so it survives:

```text
# lockin-begin
lockin.example.com {
	request_body {
		max_size 110MB
	}
	reverse_proxy 127.0.0.1:3102 {
		flush_interval -1
	}
}
# lockin-end
```

Use your real domain and the port from the service file. Each `{` block must have its contents on separate lines, or Caddy rejects the file. Always check before applying, and reload, never restart:

```bash
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy
```

## First install

`sudo ./deploy/install.sh your.domain.com` sets up Node, the service, HTTPS and nightly backups. It is for a fresh setup. Use `npm run deploy` for updates.
