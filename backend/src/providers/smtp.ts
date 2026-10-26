import nodemailer from 'nodemailer';
import { AppError } from '../common/errors';
import type { EmailProvider } from './types';

/**
 * Email over SMTP (any provider: Gmail, Zoho, SES SMTP, your own server) using nodemailer.
 * NOT verified against a real mail server: tests drive it with a fake transport. The first live
 * check is one email to an address you can read.
 */
export type MailTransport = {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string | undefined;
  }): Promise<{ messageId?: string }>;
};

export function createSmtpEmail(options: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  /** For tests. */
  transport?: MailTransport;
}): EmailProvider {
  const transport: MailTransport =
    options.transport ??
    (nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: { user: options.user, pass: options.pass },
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    }) as unknown as MailTransport);

  return {
    async send({ to, subject, text, html }) {
      // A line break in a header would let a caller add extra headers: refuse it outright.
      if (/[\r\n]/.test(to) || /[\r\n]/.test(subject)) {
        throw new AppError('VALIDATION_ERROR', 'Invalid email address or subject.');
      }
      try {
        const res = await transport.sendMail({ from: options.from, to, subject, text, html });
        return { providerMessageId: res.messageId ?? 'sent' };
      } catch {
        // Never include the transport error: it can carry the mail server's credentials or address.
        throw new AppError('PROVIDER_ERROR', 'The email could not be sent.');
      }
    },
  };
}
