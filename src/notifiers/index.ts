import type { Notification, Notifier } from './types.ts';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { log } from '../logger.ts';

const notifiers: Notifier[] = [];

export async function loadNotifiers(): Promise<void> {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.ts') && f !== 'index.ts' && f !== 'types.ts');

  for (const file of files) {
    try {
      const mod = await import(`./${file}`);
      const notifier = mod.default as Notifier;

      if (!notifier?.name || typeof notifier.send !== 'function') {
        log.warn(`Skipping invalid notifier: ${file}`);
        continue;
      }

      if (notifier.enabled) {
        notifiers.push(notifier);
        log.info(`Notifier registered: ${notifier.name}`);
      }
      else {
        log.info(`Notifier disabled: ${notifier.name}`);
      }
    }
    catch (err) {
      log.error(`Failed to load notifier: ${file}`, err);
    }
  }

  log.info(`Notifiers loaded: ${notifiers.map(n => n.name).join(', ') || 'none'}`);
}

export async function notify(notification: Notification): Promise<void> {
  await Promise.allSettled(
    notifiers.map(async (n) => {
      try {
        await n.send(notification);
      }
      catch (err) {
        log.error(`Notifier "${n.name}" failed for "${notification.title}"`, err);
      }
    }),
  );
}

export type { Notification } from './types.ts';
