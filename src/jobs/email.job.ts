import type { Job } from "bullmq";
import { logger } from "../logger.js";
import { env } from "../env.js";

/**
 * Sends transactional email. If SMTP_URL is unset, logs instead of sending —
 * keeps local/dev environments working without SMTP credentials.
 */
export async function processEmailJob(job: Job) {
  const { name, data } = job;

  if (!env.SMTP_URL) {
    logger.info({ jobName: name, data }, "[email:stub] would send email");
    return;
  }

  const nodemailer = await import("nodemailer").catch(() => null);
  if (!nodemailer) {
    logger.warn("nodemailer not installed — skipping actual send, logging instead");
    logger.info({ jobName: name, data }, "[email:stub] would send email");
    return;
  }

  const transport = nodemailer.createTransport(env.SMTP_URL);
  const { subject, html, to } = renderEmail(name, data);

  await transport.sendMail({ from: env.FROM_EMAIL, to, subject, html });
}

function renderEmail(name: string, data: any): { subject: string; html: string; to: string } {
  switch (name) {
    case "verify-email":
      return {
        to: data.email,
        subject: "Verify your email",
        html: `<p>Click to verify: <a href="https://app.gcw.app/verify?token=${data.token}">Verify</a></p>`,
      };
    case "password-reset":
      return {
        to: data.email,
        subject: "Reset your password",
        html: `<p>Reset link: <a href="https://app.gcw.app/reset?token=${data.token}">Reset</a></p>`,
      };
    case "cashout-paid":
      return { to: data.email ?? "", subject: "Your cashout was paid", html: `<p>Cashout ${data.cashoutId} paid.</p>` };
    case "milestone-hit":
      return { to: data.email ?? "", subject: "New tier unlocked!", html: `<p>You reached ${data.tier}!</p>` };
    default:
      return { to: data.email ?? "", subject: name, html: `<pre>${JSON.stringify(data)}</pre>` };
  }
}
