import type { Notification, Notifier } from './types.ts';
import { log } from '../logger.ts';

// eslint-disable-next-line node/prefer-global/process
const enabled = process.env.DESKTOP_NOTIFICATIONS !== '0';

const notifier: Notifier = {
  name: 'mako',
  enabled,

  async send(notification: Notification) {
    const urgency = notification.priority === 'urgent' ? 'critical' : 'normal';

    // Fire-and-forget: notify-send --wait blocks until click/dismiss,
    // then opens URL if the default action is invoked
    const proc = Bun.spawn([
      '/usr/bin/notify-send',
      '--app-name=news-alert',
      `--urgency=${urgency}`,
      '-A',
      'default=Open Article',
      notification.title,
      notification.body,
    ], { stdout: 'pipe', stderr: 'pipe' });

    // Don't await — handle click in background
    proc.exited.then(async () => {
      const stdout = await new Response(proc.stdout).text();
      if (stdout.trim() === 'default') {
        Bun.spawn([
          'xdg-open',
          notification.url,
        ], { stdout: 'ignore', stderr: 'ignore' });
      }
    }).catch(err => log.error(`[mako] Action handler failed`, err));

    log.info(`[mako] Notification sent: "${notification.title}"`);
  },
};

export default notifier;
