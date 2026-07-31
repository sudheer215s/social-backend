import type { EmailMessage, EmailPort, SentEmailRecord } from './email.port';

/**
 * Dev/test adapter: logs email and keeps an in-memory outbox for assertions.
 */
export class ConsoleEmailAdapter implements EmailPort {
  readonly sent: SentEmailRecord[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push({ ...message, sentAt: new Date() });
    // Intentionally verbose for local/dev only.

    console.info(
      `[email] to=${message.to} subject=${JSON.stringify(message.subject)}`,
    );
    return Promise.resolve();
  }

  clear(): void {
    this.sent.length = 0;
  }

  lastTo(address: string): SentEmailRecord | undefined {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      const m = this.sent[i];
      if (m?.to.toLowerCase() === address.toLowerCase()) {
        return m;
      }
    }
    return undefined;
  }
}
