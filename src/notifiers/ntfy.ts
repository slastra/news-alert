import type { Notification, Notifier } from './types.ts';
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

    await fetch(NTFY_TOPIC, {
      method: 'POST',
      headers: {
        Title: notification.title,
        Priority: notification.priority,
        Tags: tags,
        Click: notification.url,
      },
      body: notification.body,
    });

    log.info(`[ntfy] Notification sent: "${notification.title}"`);
  },
};

export default notifier;
