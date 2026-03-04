const express = require("express");
const router = express.Router();
const { SESClient, SendRawEmailCommand } = require("@aws-sdk/client-ses");
const { requireAuth } = require("../middleware/auth");
const { getProfile } = require("../services/dynamodb");

const sesClient = new SESClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
  },
});

const SENDER_EMAIL = process.env.SES_SENDER_EMAIL || "noreply@novatryonme.com";

/**
 * POST /api/share/email
 * Send a try-on result image to an email address.
 * Body: { recipientEmail, imageBase64, productTitle, message? }
 */
router.post("/email", requireAuth, async (req, res, next) => {
  try {
    const { recipientEmail, imageBase64, productTitle, message } = req.body;

    if (!recipientEmail || !imageBase64) {
      return res.status(400).json({ error: "recipientEmail and imageBase64 are required" });
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return res.status(400).json({ error: "Invalid email address" });
    }

    // Get sender name from profile
    const profile = await getProfile(req.userId);
    const senderName = profile?.firstName ? `${profile.firstName}` : "Someone";

    const subject = productTitle
      ? `${senderName} shared a virtual try-on: ${productTitle}`
      : `${senderName} shared a virtual try-on result with you`;

    const userMessage = message ? `<p style="font-size:14px;color:#333;margin-bottom:16px;">"${message}"</p>` : "";

    const boundary = `----=_Part_${Date.now()}`;
    const htmlBody = `
<div style="font-family:system-ui,-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="text-align:center;padding:16px;background:linear-gradient(135deg,#FF9900,#E88B00);border-radius:8px 8px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:18px;">SuperNova TryOnMe</h2>
  </div>
  <div style="padding:20px;background:#fff;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px;">
    <p style="font-size:15px;color:#333;margin-bottom:12px;">${senderName} tried on ${productTitle ? `<strong>${productTitle}</strong>` : "an item"} and wanted to share the result with you!</p>
    ${userMessage}
    <div style="text-align:center;margin:16px 0;">
      <img src="cid:tryon-result" alt="Virtual try-on result" style="max-width:100%;border-radius:8px;border:1px solid #eee;" />
    </div>
    <p style="font-size:12px;color:#999;text-align:center;margin-top:16px;">Powered by SuperNova TryOnMe — AI Virtual Try-On</p>
  </div>
</div>`;

    // Build raw MIME message with embedded image
    const rawMessage = [
      `From: SuperNova TryOnMe <${SENDER_EMAIL}>`,
      `To: ${recipientEmail}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/related; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      htmlBody,
      ``,
      `--${boundary}`,
      `Content-Type: image/jpeg`,
      `Content-Transfer-Encoding: base64`,
      `Content-ID: <tryon-result>`,
      `Content-Disposition: inline; filename="tryon-result.jpg"`,
      ``,
      imageBase64.match(/.{1,76}/g).join("\n"),
      ``,
      `--${boundary}--`,
    ].join("\r\n");

    await sesClient.send(new SendRawEmailCommand({
      RawMessage: { Data: Buffer.from(rawMessage) },
    }));

    console.log(`[share] Email sent to ${recipientEmail} by user ${req.userId}`);
    res.json({ success: true, message: `Try-on result sent to ${recipientEmail}` });
  } catch (error) {
    console.error(`[share] Email send failed:`, error.message);

    if (error.name === "MessageRejected" || error.message.includes("Email address is not verified")) {
      return res.status(400).json({ error: "Email sending is not configured yet. The sender email needs to be verified in AWS SES." });
    }
    next(error);
  }
});

module.exports = router;
