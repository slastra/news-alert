import type { Storage } from './storage.ts';
import {
  EARTHQUAKE_GLOBAL_MIN_MAG,
  EARTHQUAKE_LOCAL_MIN_MAG,
  EARTHQUAKE_LOCAL_RADIUS_KM,
  HAZARD_LOCATION,
  NTFY_TOPIC,
  REQUEST_TIMEOUT_MS,
  USER_AGENT,
} from './config.ts';
import { log } from './logger.ts';

export interface HazardAlert {
  source: string;
  id: string;
  title: string;
  description: string;
  severity: 'extreme' | 'severe';
  url: string;
}

// --- NWS Alerts (weather + civil emergencies) ---

// Always notify for these event types regardless of severity
const CRITICAL_EVENT_TYPES = new Set([
  'Child Abduction Emergency',
  'Blue Alert',
  'Civil Danger Warning',
  'Civil Emergency Message',
  'Evacuation Immediate',
  'Shelter In Place Warning',
  'Nuclear Power Plant Warning',
  'Radiological Hazard Warning',
  'Hazardous Materials Warning',
  'Law Enforcement Warning',
  '911 Telephone Outage',
  'Local Area Emergency',
]);

interface NWSFeature {
  properties: {
    id: string;
    event: string;
    severity: string;
    urgency: string;
    headline: string;
    areaDesc: string;
    description: string;
  };
}

interface NWSResponse {
  features: NWSFeature[];
}

async function fetchWeatherAlerts(): Promise<HazardAlert[]> {
  const url = `https://api.weather.gov/alerts/active?point=${HAZARD_LOCATION.lat},${HAZARD_LOCATION.lon}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/geo+json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok)
    throw new Error(`NWS API ${res.status}`);

  const data = await res.json() as NWSResponse;

  return data.features
    .filter((f) => {
      const isSevere = f.properties.severity === 'Extreme' || f.properties.severity === 'Severe';
      const isCriticalEvent = CRITICAL_EVENT_TYPES.has(f.properties.event);
      return isSevere || isCriticalEvent;
    })
    .map((f) => {
      const isCriticalEvent = CRITICAL_EVENT_TYPES.has(f.properties.event);
      // Civil emergencies get 'extreme' regardless of NWS severity classification
      const severity = f.properties.severity === 'Extreme' || isCriticalEvent
        ? 'extreme' as const
        : 'severe' as const;
      return {
        source: 'NWS',
        id: f.properties.id,
        title: f.properties.headline || f.properties.event,
        description: `${f.properties.event} — ${f.properties.areaDesc}`,
        severity,
        url: 'https://alerts.weather.gov',
      };
    });
}

// --- USGS Earthquakes ---

interface USGSFeature {
  id: string;
  properties: {
    mag: number;
    place: string;
    time: number;
    url: string;
  };
}

interface USGSResponse {
  features: USGSFeature[];
}

async function fetchEarthquakes(): Promise<HazardAlert[]> {
  const since = new Date(Date.now() - 86400_000).toISOString().split('T')[0];
  const headers = { 'User-Agent': USER_AGENT };
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  // Local earthquakes (4.0+ within radius)
  const localUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${since}&minmagnitude=${EARTHQUAKE_LOCAL_MIN_MAG}&latitude=${HAZARD_LOCATION.lat}&longitude=${HAZARD_LOCATION.lon}&maxradiuskm=${EARTHQUAKE_LOCAL_RADIUS_KM}`;

  // Global significant earthquakes (6.0+)
  const globalUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${since}&minmagnitude=${EARTHQUAKE_GLOBAL_MIN_MAG}`;

  const [localRes, globalRes] = await Promise.all([
    fetch(localUrl, { headers, signal: timeout }),
    fetch(globalUrl, { headers, signal: timeout }),
  ]);

  if (!localRes.ok)
    throw new Error(`USGS local API ${localRes.status}`);
  if (!globalRes.ok)
    throw new Error(`USGS global API ${globalRes.status}`);

  const localData = await localRes.json() as USGSResponse;
  const globalData = await globalRes.json() as USGSResponse;

  // Merge and dedupe by ID
  const seen = new Set<string>();
  const all: USGSFeature[] = [];
  for (const f of [...localData.features, ...globalData.features]) {
    if (!seen.has(f.id)) {
      seen.add(f.id);
      all.push(f);
    }
  }

  return all.map(f => ({
    source: 'USGS Earthquake',
    id: f.id,
    title: `M${f.properties.mag.toFixed(1)} — ${f.properties.place}`,
    description: `Magnitude ${f.properties.mag.toFixed(1)} earthquake at ${f.properties.place}`,
    severity: f.properties.mag >= 7.0 ? 'extreme' as const : 'severe' as const,
    url: f.properties.url,
  }));
}

// --- USGS Volcanoes ---

interface VolcanoEntry {
  vnum: string;
  volcano_name: string;
  alert_level: string;
  notice_url: string;
}

async function fetchVolcanoes(): Promise<HazardAlert[]> {
  const url = 'https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes';
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok)
    throw new Error(`USGS Volcano API ${res.status}`);

  const data = await res.json() as VolcanoEntry[];

  return data
    .filter(v => v.alert_level === 'WARNING' || v.alert_level === 'WATCH')
    .map(v => ({
      source: 'USGS Volcano',
      id: `${v.vnum}-${v.alert_level}`,
      title: `${v.volcano_name} — ${v.alert_level}`,
      description: `Volcano ${v.volcano_name} at alert level ${v.alert_level}`,
      severity: v.alert_level === 'WARNING' ? 'extreme' as const : 'severe' as const,
      url: v.notice_url,
    }));
}

// --- NASA DONKI Space Weather ---

interface GSTEvent {
  gstID: string;
  startTime: string;
  allKpIndex: { kpIndex: number; observedTime: string }[];
  link: string;
}

async function fetchSpaceWeather(): Promise<HazardAlert[]> {
  const since = new Date(Date.now() - 86400_000).toISOString().split('T')[0];
  const url = `https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/GST?startDate=${since}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok)
    throw new Error(`DONKI API ${res.status}`);

  const data = await res.json() as GSTEvent[];

  return data
    .filter(e => e.allKpIndex?.some(k => k.kpIndex >= 7))
    .map((e) => {
      const maxKp = Math.max(...e.allKpIndex.map(k => k.kpIndex));
      const gScale = maxKp >= 9 ? 'G5' : maxKp >= 8 ? 'G4' : maxKp >= 7 ? 'G3' : 'G2';
      return {
        source: 'NASA DONKI',
        id: e.gstID,
        title: `Geomagnetic Storm ${gScale} (Kp${maxKp})`,
        description: `${gScale} geomagnetic storm detected, Kp index ${maxKp}`,
        severity: maxKp >= 8 ? 'extreme' as const : 'severe' as const,
        url: e.link || 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/',
      };
    });
}

// --- Notification ---

const HAZARD_TAGS: Record<string, string> = {
  'NWS': 'tornado,warning',
  'USGS Earthquake': 'earthquake,warning',
  'USGS Volcano': 'volcano,warning',
  'NASA DONKI': 'sunny,warning',
};

async function sendHazardAlert(hazard: HazardAlert): Promise<void> {
  try {
    await fetch(NTFY_TOPIC, {
      method: 'POST',
      headers: {
        Title: `[${hazard.severity.toUpperCase()}] ${hazard.source}`,
        Priority: hazard.severity === 'extreme' ? 'urgent' : 'high',
        Tags: HAZARD_TAGS[hazard.source] ?? 'warning',
        Click: hazard.url,
      },
      body: `${hazard.title}\n\n${hazard.description}`,
    });
    log.info(`Hazard notification sent: "${hazard.title}"`);
  }
  catch (err) {
    log.error(`Failed to send hazard notification for "${hazard.title}"`, err);
  }
}

// --- Main poll function ---

type FetchFn = () => Promise<HazardAlert[]>;

const SOURCES: { name: string; fetch: FetchFn }[] = [
  { name: 'NWS Weather', fetch: fetchWeatherAlerts },
  { name: 'USGS Earthquakes', fetch: fetchEarthquakes },
  { name: 'USGS Volcanoes', fetch: fetchVolcanoes },
  { name: 'NASA DONKI', fetch: fetchSpaceWeather },
];

export async function pollHazards(storage: Storage): Promise<void> {
  let totalNew = 0;

  for (const source of SOURCES) {
    try {
      const alerts = await source.fetch();

      for (const alert of alerts) {
        if (storage.isHazardSeen(alert.source, alert.id))
          continue;

        storage.markHazardSeen(alert.source, alert.id, alert.title, alert.severity);
        await sendHazardAlert(alert);
        totalNew++;
        log.info(`New hazard: [${alert.severity}] ${alert.source}: "${alert.title}"`);
      }
    }
    catch (err) {
      log.error(`Hazard fetch failed: ${source.name}`, err);
    }
  }

  if (totalNew > 0) {
    log.info(`Hazard poll: ${totalNew} new alert(s)`);
  }
}
