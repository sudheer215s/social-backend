/**
 * Outbound email port (P1-T05).
 * Production will swap ConsoleEmailAdapter for SES/SendGrid behind this interface.
 */
export const EMAIL_PORT = Symbol('EMAIL_PORT');

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML body for real providers later. */
  html?: string;
}

export interface EmailPort {
  send(message: EmailMessage): Promise<void>;
}

export interface SentEmailRecord extends EmailMessage {
  sentAt: Date;
}
