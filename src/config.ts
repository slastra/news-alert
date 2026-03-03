import path from 'node:path';

export const DB_PATH = path.join(import.meta.dirname, '..', 'data', 'news-alert.sqlite');
export const REQUEST_TIMEOUT_MS = 10_000;
export const USER_AGENT = 'news-alert/1.0 (RSS feed monitor)';

export const POLL_INTERVALS = {
  primary: 60_000, // 60 seconds
  secondary: 300_000, // 5 minutes
  lemmy: 300_000, // 5 minutes
} as const;

export type PollGroup = keyof typeof POLL_INTERVALS;

export const SERVER_PORT = 3100;

// Location
// eslint-disable-next-line node/prefer-global/process
export const LOCATION_NAME = process.env.LOCATION_NAME ?? 'the United States';
// eslint-disable-next-line node/prefer-global/process
export const HAZARD_LOCATION = { lat: Number(process.env.HAZARD_LAT ?? 0), lon: Number(process.env.HAZARD_LON ?? 0) };
export const HAZARD_POLL_MS = 120_000; // 2 minutes
export const EARTHQUAKE_LOCAL_RADIUS_KM = 300;
export const EARTHQUAKE_LOCAL_MIN_MAG = 4.0;
export const EARTHQUAKE_GLOBAL_MIN_MAG = 6.0;
