import nodemailer from 'nodemailer';
import { config } from '../config';
import { createAgentLogger } from '../logger/logger';
import { EmailData } from '../types';

const logger = createAgentLogger('email-service');

export class EmailService {
  private readonly transporter = nodemailer.createTransport({
    host: config.email.smtpHost,
    port: config.email.smtpPort,
    secure: config.email.smtpPort === 465,
    auth: config.email.smtpUser
      ? {
          user: config.email.smtpUser,
          pass: config.email.smtpPass
        }
      : undefined
  });

  async send(data: EmailData): Promise<void> {
    if (!config.email.smtpUser || !config.email.smtpPass) {
      logger.warn('SMTP credentials are missing; email not sent', { subject: data.subject });
      return;
    }

    try {
      await this.transporter.sendMail({
        from: config.email.from,
        to: data.to,
        subject: data.subject,
        html: data.html,
        text: data.text
      });
      logger.info('Email sent', { subject: data.subject, to: data.to });
    } catch (error) {
      logger.warn('Email send failed (non-fatal)', { error: (error as Error).message, subject: data.subject });
    }
  }
}

export const emailService = new EmailService();
