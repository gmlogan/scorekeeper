// Sends the password-reset email via Brevo's transactional email REST API
// (https://api.brevo.com/v3/smtp/email) using Node's built-in fetch — no
// extra dependency for a single JSON POST.
//
// Stub mode: BREVO_API_KEY unset (local dev, CI, and production until the
// sending domain's SPF/DKIM/DMARC is verified in Brevo) just logs the reset
// URL instead of calling out. Same function either way, so turning on real
// sending later is a one-line env change — no code change.
//
// EMAIL_LOG_ENABLED=true additionally logs to/from/subject/body for every
// outgoing email (stub or live) — for debugging deliverability/content
// issues. Read fresh on every call, so it's just an env var + container
// restart to flip, no code change either.
const logEmailIfEnabled = ({ to, from, subject, body }) => {
  if (process.env.EMAIL_LOG_ENABLED !== 'true') return;
  console.log(`[email:log] to=${to} from=${from} subject=${JSON.stringify(subject)}\n${body}`);
};

const sendPasswordResetEmail = async (toEmail, resetUrl) => {
  const from = process.env.BREVO_SENDER_EMAIL;
  const subject = 'Reset your Scorekeeper password';
  const htmlContent = `<p>Click the link below to reset your password. This link expires in 30 minutes.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can ignore this email.</p>`;

  logEmailIfEnabled({ to: toEmail, from, subject, body: htmlContent });

  if (!process.env.BREVO_API_KEY) {
    console.log(`[email:stub] Password reset for ${toEmail}: ${resetUrl}`);
    return;
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: from },
      to: [{ email: toEmail }],
      subject,
      htmlContent,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo send failed: ${res.status} ${body}`);
  }
};

module.exports = { sendPasswordResetEmail };
