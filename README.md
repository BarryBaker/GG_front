# GG Poker Leaderboard Tracker

## Run with Docker

Docker and the Docker Compose plugin are required. From the repository directory:

```sh
docker compose up --build -d
```

Open [http://localhost:8080](http://localhost:8080). The container serves the
production-built frontend with Nginx and restarts automatically if it stops.
Check its status with `docker compose ps`; stop it with `docker compose down`.

To build and run the image directly instead:

```sh
docker build -t gg-leaderboard .
docker run -d --name gg-leaderboard --restart unless-stopped -p 8080:80 gg-leaderboard
```

## API

| Frontend | API |
| --- | --- |
| Netlify deployment | `https://85-190-101-59.sslip.io` |
| `npm run dev` on your Mac | VPS through the SSH tunnel on `127.0.0.1:18000` |
| `npm run dev:local` on your Mac | Local Docker API on `127.0.0.1:8000` |

The production build uses `http://127.0.0.1:8000` when opened on `localhost`
or `127.0.0.1`.

## Local development with Docker

With the API from `~/Documents/GG` running in Docker, check that it can reach
its database by requesting `/tables` from your Mac.

```sh
curl --fail-with-body --show-error --max-time 10 http://127.0.0.1:8000/tables
```

From this frontend repository, stop the running Vite server with Ctrl+C and
start it in local API mode. Run `npm ci` first if dependencies are missing.

```sh
npm run dev:local
```

Open the URL Vite prints. Vite forwards `/api/tables` to the Docker API at
`http://127.0.0.1:8000/tables`. To switch back to the tunnel, restart Vite with
`npm run dev`.

For a fully local database, leave `DATABASE_PRIVATE_URL` unset in `GG`'s local
Compose environment so the API uses the Compose PostgreSQL service.

## Local development with the VPS

Start the SSH tunnel in one terminal and leave it running while using the app.

```sh
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:18000:127.0.0.1:8000 administrator@85.190.101.59
```

The terminal normally stays quiet after login. In a second terminal, check that
the API returns JSON through the tunnel before starting Vite.

```sh
curl --fail-with-body --show-error --max-time 10 http://127.0.0.1:18000/tables
npm ci
npm run dev
```

Open the local URL Vite prints. Vite serves `/api` requests through the
tunnel, for example forwarding `/api/tables` to the VPS API at `/tables`.

If SSH reports `open failed: connect failed: Connection refused` when you run
`curl`, check that the API is running and reachable at `127.0.0.1:8000` on the
VPS. You can check from a VPS SSH shell with `curl -i http://127.0.0.1:8000/tables`.
