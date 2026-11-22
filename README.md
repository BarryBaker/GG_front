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

This repository contains the frontend only. The frontend calls the existing
hosted API at `https://soothing-alignment-production.up.railway.app`; the API
and its data are not included in this Docker image. When the page is opened on
localhost, the frontend instead expects the API at `http://localhost:8000`.

## Local development

```sh
npm ci
npm run dev
```
