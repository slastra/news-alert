import type { Notification, Notifier } from './types.ts';
import { REQUEST_TIMEOUT_MS } from '../config.ts';
import { log } from '../logger.ts';

// eslint-disable-next-line node/prefer-global/process
const NTFY_TOPIC = process.env.NTFY_TOPIC ?? '';

const TAGS: Record<string, string> = {
  'NWS': 'tornado,warning',
  'USGS Earthquake': 'earthquake,warning',
  'USGS Volcano': 'volcano,warning',
  'NASA DONKI': 'sunny,warning',
};

const notifier: Notifier = {
  name: 'ntfy',
  enabled: !!NTFY_TOPIC,

  async send(notification: Notification) {
    const tags = TAGS[notification.source] ?? (notification.priority === 'urgent' ? 'rotating_light,warning' : 'warning');

    const res = await fetch(NTFY_TOPIC, {
      method: 'POST',
      headers: {
        Title: notification.title,
        Priority: notification.priority,
        Tags: tags,
        Click: notification.url,
      },
      body: notification.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`ntfy ${res.status} ${res.statusText}`);
    }

    log.info(`[ntfy] Notification sent: "${notification.title}"`);
  },
};

export default notifier;
