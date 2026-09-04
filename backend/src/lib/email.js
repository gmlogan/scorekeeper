// Sends the password-reset email via Brevo's transactional email REST API
// (https://api.brevo.com/v3/smtp/email) using Node's built-in fetch — no
// extra dependency for a single JSON POST.
//
// Stub mode: BREVO_API_KEY unset (local dev, CI, and production until the
// sending domain's SPF/DKIM/DMARC is verified in Brevo) just logs the reset
// URL instead of calling out. Same function either way, so turning on real
// sending later is a one-line env change — no code change.
const sendPasswordResetEmail = async (toEmail, resetUrl) => {
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
      sender: { email: process.env.BREVO_SENDER_EMAIL },
      to: [{ email: toEmail }],
      subject: 'Reset your Scorekeeper password',
      htmlContent: `<p>Click the link below to reset your password. This link expires in 30 minutes.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo send failed: ${res.status} ${body}`);
  }
};

module.exports = { sendPasswordResetEmail };
