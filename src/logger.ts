function timestamp(): string {
  return new Date().toISOString();
}

function format(level: string, msg: string): string {
  return `[${timestamp()}] [${level}] ${msg}`;
}

export const log = {
  info(msg: string) {
    // eslint-disable-next-line no-console
    console.log(format('INFO', msg));
  },

  warn(msg: string) {
    console.warn(format('WARN', msg));
  },

  error(msg: string, err?: unknown) {
    const suffix = err instanceof Error ? `: ${err.message}` : '';
    console.error(format('ERROR', `${msg}${suffix}`));
  },

  article(source: string, title: string, url: string) {
    // eslint-disable-next-line no-console
    console.log(format('NEW', `${source}: "${title}" (${url})`));
  },
};
