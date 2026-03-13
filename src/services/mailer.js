const dns = require('dns');
const nodemailer = require('nodemailer');
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = require('../config');

// Force IPv4 — Render free tier doesn't support IPv6
dns.setDefaultResultOrder('ipv4first');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }
  return transporter;
}

async function sendEmail(to, message) {
  if (!SMTP_USER || !SMTP_PASS) {
    console.log(`[Mailer] SMTP not configured — skipping email to ${to}`);
    return false;
  }

  const mail = getTransporter();
  await mail.sendMail({
    from: `"Time Capsule" <${SMTP_FROM}>`,
    to,
    subject: 'You have a Time Capsule message!',
    text: message,
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #818cf8;">Time Capsule</h2>
        <p style="color: #64748b; font-size: 14px;">Someone sent you a message from the past:</p>
        <div style="background: #f1f5f9; border-radius: 8px; padding: 16px; margin: 16px 0; font-size: 16px; color: #1e293b;">
          ${message.replace(/\n/g, '<br>')}
        </div>
        <p style="color: #94a3b8; font-size: 12px;">Sent via Time Capsule Messaging</p>
      </div>
    `,
  });

  return true;
}

module.exports = { sendEmail };
