import { isMailConfigured, sendMail } from "../../utils/mailer.js";
import { listTeamMemberEmails } from "../../utils/teamDirectory.js";

function normalizeString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeEmail(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseRecipientList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(normalizeEmail).filter(Boolean);
  }
  return String(value)
    .split(/[,;\s]+/)
    .map(normalizeEmail)
    .filter(Boolean);
}

function dedupeEmails(values = []) {
  const seen = new Set();
  const result = [];
  values.forEach((email) => {
    const normalized = normalizeEmail(email);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(email);
  });
  return result;
}

function resolveContactRecipients() {
  const envCandidates = [
    process.env.CONTACT_FORM_RECIPIENTS,
    process.env.CONTACT_RECIPIENTS,
    process.env.CONTACT_EMAIL,
    process.env.SUPPORT_EMAIL,
  ];

  const recipients = dedupeEmails(
    envCandidates.flatMap((value) => parseRecipientList(value))
  );

  if (recipients.length) {
    return recipients;
  }

  const fallback = dedupeEmails(listTeamMemberEmails());
  if (fallback.length) {
    return fallback;
  }

  const smtpUser = normalizeEmail(
    process.env.MAIL_FROM || process.env.SMTP_USER
  );
  return smtpUser ? [smtpUser] : [];
}

function formatEmailBody({ name, email, subject, message, submittedAt }) {
  const submittedLabel = submittedAt.toISOString();
  const safeMessage = escapeHtml(message || "");
  const safeName = escapeHtml(name || "");
  const safeEmail = escapeHtml(email || "");
  const lines = [
    "New contact form submission received.",
    `Submitted at: ${submittedLabel}`,
    name ? `Name: ${name}` : null,
    email ? `Email: ${email}` : null,
    "",
    message,
  ].filter(Boolean);

  const text = lines.join("\n");

  const html = `
    <p><strong>New contact form submission received.</strong></p>
    <ul>
      <li><strong>Submitted at:</strong> ${submittedLabel}</li>
      ${name ? `<li><strong>Name:</strong> ${safeName}</li>` : ""}
      ${email ? `<li><strong>Email:</strong> ${safeEmail}</li>` : ""}
    </ul>
    <p><strong>Message:</strong></p>
    <blockquote>${safeMessage.replace(/\n/g, "<br>")}</blockquote>
  `;

  return { text, html };
}

function isLikelyEmail(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export const handler = async (event) => {
  if (!isMailConfigured()) {
    return {
      statusCode: 503,
      body: JSON.stringify({
        error:
          "Email service is not configured. Set SMTP credentials to enable contact form notifications.",
      }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  const name = normalizeString(body?.name);
  const email = normalizeString(body?.email);
  const subject = normalizeString(body?.subject);
  const message = normalizeString(body?.message);

  if (!subject) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Subject is required" }),
    };
  }

  if (!message) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Message is required" }),
    };
  }

  if (!email || !isLikelyEmail(email)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "A valid email address is required" }),
    };
  }

  const recipients = resolveContactRecipients();
  if (!recipients.length) {
    return {
      statusCode: 503,
      body: JSON.stringify({
        error:
          "No contact recipients configured. Set CONTACT_FORM_RECIPIENTS or CONTACT_EMAIL in the environment.",
      }),
    };
  }

  const safeSubject = subject.startsWith("Website contact:")
    ? subject
    : `Website contact: ${subject}`;

  const { text, html } = formatEmailBody({
    name,
    email,
    subject,
    message,
    submittedAt: new Date(),
  });

  try {
    const mailResult = await sendMail({
      to: recipients,
      subject: safeSubject,
      text,
      html,
      replyTo: email,
      headers: {
        "X-Entity": "contact-form-message",
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        sent_to: mailResult.to,
        message_id: mailResult.messageId || null,
      }),
    };
  } catch (error) {
    console.error("Contact form email failed", error);
    const status =
      typeof error?.statusCode === "number" && error.statusCode >= 400
        ? error.statusCode
        : 500;
    return {
      statusCode: status,
      body: JSON.stringify({
        error: "Failed to send contact email",
        details: error?.message || null,
      }),
    };
  }
};
