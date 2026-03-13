const { Resend } = require('resend');
const { RESEND_API_KEY, RESEND_FROM } = require('../config');

async function sendEmail(to, message) {
  if (!RESEND_API_KEY) {
    console.log(`[Mailer] RESEND_API_KEY not configured — skipping email to ${to}`);
    return false;
  }

  const resend = new Resend(RESEND_API_KEY);

  await resend.emails.send({
    from: RESEND_FROM,
    to,
    subject: 'You have a Time Capsule message!',
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #4f46e5;">Time Capsule</h2>
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
