export interface Notification {
  title: string;
  body: string;
  url: string;
  priority: 'urgent' | 'high';
  source: string;
}

export interface Notifier {
  name: string;
  enabled: boolean;
  send: (notification: Notification) => Promise<void>;
}
