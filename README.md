# news-alert

Stop doomscrolling. Get notified when it actually matters.

news-alert monitors RSS feeds and natural hazard APIs in the background, scoring headlines with LLMs and sending push notifications only when something genuinely critical is happening. Everything else stays silent.

## What it monitors

**News** — 10 RSS feeds (BBC, Sky News, Google News, Al Jazeera, CBS, Guardian, NYT, NPR, France 24, Lemmy) polled every 60s–5min. Headlines are batch-scored 1–10 by Amazon Nova Lite. Articles scoring 8+ are confirmed by Claude Haiku before sending a notification, preventing clickbait from getting through.

**Weather & Civil Emergencies** — NWS alerts for your location, including severe weather *and* non-weather emergencies: AMBER alerts, evacuation orders, shelter-in-place, hazmat warnings, nuclear plant warnings, law enforcement alerts, 911 outages.

**Earthquakes** — USGS API for local quakes (4.0+ within 300km of your location) and significant global earthquakes (6.0+).

**Volcanoes** — USGS Volcano Hazards Program for elevated volcanic activity (WATCH/WARNING level).

**Space Weather** — NASA DONKI for geomagnetic storms (Kp 7+, G3 or higher).

## How it works

```
RSS Feeds ──→ Nova Lite (score 1-10) ──→ Haiku (confirm 8+) ──→ ntfy push
NWS API ────→ severity filter ──────────────────────────────→ ntfy push
USGS/NASA ──→ threshold filter ─────────────────────────────→ ntfy push
```

The Haiku confirmation step receives context about all notifications already sent in the last 24 hours (both news and hazard alerts), so it won't send duplicate notifications for the same event.

## Setup

### Prerequisites

- [Bun](https://bun.sh) runtime
- AWS account with [Bedrock](https://aws.amazon.com/bedrock/) access (us-east-1) for Nova Lite and Claude Haiku
- [ntfy](https://ntfy.sh) for push notifications (free, no account needed)

### Install

```bash
git clone https://github.com/slastra/news-alert.git
cd news-alert
bun install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Pick a unique topic name — anyone with the name can see your notifications
NTFY_TOPIC=https://ntfy.sh/your-unique-topic-name

# Your coordinates for local weather/earthquake alerts
HAZARD_LAT=40.7128
HAZARD_LON=-74.0060
```

Set up AWS credentials for Bedrock access (Nova Lite + Claude Haiku):

```bash
aws configure  # or set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in .env
```

Install the [ntfy app](https://ntfy.sh) on your phone and subscribe to your topic.

### Run

```bash
bun start
```

For production, use a process manager:

```bash
# PM2
pm2 start bun --name news-alert -- start

# systemd
# Create a service file pointing to `bun start` in the project directory
```

## Endpoints

The status server runs on port 3100:

| Endpoint | Description |
|----------|-------------|
| `GET /status` | Current composite score, article rates by source, top articles, feed health |
| `GET /summary` | Live LLM-generated 2–3 sentence news briefing |
| `GET /history?from=ISO&to=ISO` | Hourly status snapshots (defaults to last 24h) |
| `GET /hazards` | Recent hazard alerts from last 24h |

## Cost

All hazard APIs (NWS, USGS, NASA) are free with no API keys. The only cost is Bedrock LLM usage:

- **Nova Lite** — batch-scores headlines (~$0.005/day)
- **Claude Haiku** — confirms critical articles + hourly summaries (~$0.005/day)
- **Total** — ~$0.01/day (~$0.30/month)

## Project structure

```
src/
├── index.ts        Entry point, poll scheduling, graceful shutdown
├── config.ts       Constants and environment variables
├── feeds.ts        RSS feed list and poll groups
├── fetcher.ts      HTTP fetch with ETag/Last-Modified caching
├── parser.ts       RSS XML normalization
├── storage.ts      SQLite persistence and queries
├── poller.ts       Feed poll loop: fetch → parse → dedupe → score → notify
├── bedrock.ts      Shared AWS Bedrock client (Nova Lite + Haiku)
├── scorer.ts       Two-tier LLM scoring with duplicate-aware confirmation
├── summarizer.ts   LLM news summary generation
├── hazards.ts      Natural hazard monitoring (NWS, USGS, NASA)
├── notify.ts       ntfy.sh push notifications
├── server.ts       HTTP status endpoints
└── logger.ts       Timestamped console logging
```

## License

MIT
