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

export interface NotifyResult {
  attempted: number;
  succeeded: number;
}

export async function notify(notification: Notification): Promise<NotifyResult> {
  const results = await Promise.allSettled(
    notifiers.map(n => n.send(notification)),
  );
  let succeeded = 0;
  for (const [i, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      succeeded++;
    }
    else {
      const name = notifiers[i]?.name ?? '?';
      log.error(`Notifier "${name}" failed for "${notification.title}"`, result.reason);
    }
  }
  return { attempted: notifiers.length, succeeded };
}

export type { Notification } from './types.ts';
