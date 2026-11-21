import type { FastifyBaseLogger } from 'fastify';
import { createTransport, type Transporter } from 'nodemailer';
import type { Config } from '../config.js';

/**
 * Letters of the platform (stage 5, A7; ADR-021): today only "set a new password". Sent by SMTP
 * when the site has a mail account (`SMTP_URL`); otherwise written to the log, which is what a
 * developer and a school computer want.
 */

export interface Letter {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(letter: Letter): Promise<void>;
}

/** No mail account: the letter goes to the log, link included — for a developer to click. */
export class LogMailer implements Mailer {
  readonly sent: Letter[] = [];

  constructor(private readonly log?: FastifyBaseLogger) {}

  send(letter: Letter): Promise<void> {
    this.sent.push(letter);
    this.log?.info(
      { to: letter.to, subject: letter.subject, text: letter.text },
      'letter (no SMTP)',
    );
    return Promise.resolve();
  }
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = createTransport(smtpUrl);
  }

  async send(letter: Letter): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...letter });
  }
}

export function createMailer(config: Config, log: FastifyBaseLogger): Mailer {
  return config.mail.smtpUrl
    ? new SmtpMailer(config.mail.smtpUrl, config.mail.from)
    : new LogMailer(log);
}
