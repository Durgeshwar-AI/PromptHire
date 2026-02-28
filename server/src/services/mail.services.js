import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send a rejection email to a candidate.
 *
 * @param {string} to        – Candidate email address
 * @param {string} name      – Candidate name
 * @param {string} jobTitle  – Role they applied for
 */
async function sendRejectionEmail(to, name, jobTitle) {
  const mailOptions = {
    from: process.env.MAIL_FROM || "AgenticHire <noreply@agentichire.com>",
    to,
    subject: `Application Update — ${jobTitle}`,
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;color:#1a1a1a;">
        <h2 style="margin:0 0 16px;font-size:22px;">Application Update</h2>
        <p>Dear <strong>${name || "Candidate"}</strong>,</p>
        <p>
          Thank you for your interest in the <strong>${jobTitle}</strong> position
          and for taking the time to apply.
        </p>
        <p>
          After a thorough review of all applicants, we have decided to move
          forward with other candidates whose qualifications more closely match
          the requirements of this role.
        </p>
        <p>
          We truly appreciate your effort and encourage you to apply for future
          openings that align with your skills and experience.
        </p>
        <p>We wish you the very best in your career journey.</p>
        <br />
        <p style="margin:0;">Warm regards,<br /><strong>The AgenticHire Team</strong></p>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
}

export { sendRejectionEmail };

/**
 * Notify a shortlisted candidate about the next pipeline stage and its schedule.
 *
 * @param {string} to         – Candidate email
 * @param {string} name       – Candidate name
 * @param {string} jobTitle   – Role title
 * @param {Object} stage      – Pipeline stage object { stageName, stageType, scheduledDate, order }
 */
async function sendSchedulingEmail(to, name, jobTitle, stage) {
  if (!to) return;

  const STAGE_ICONS = {
    resume_screening: "📄",
    aptitude_test: "🧠",
    coding_challenge: "💻",
    ai_voice_interview: "🎙️",
    technical_interview: "⚙️",
    custom_round: "🛠️",
  };

  const icon = STAGE_ICONS[stage.stageType] || "📋";
  const stageName =
    stage.stageName ||
    stage.stageType?.replace(/_/g, " ") ||
    `Round ${stage.order}`;
  const dateStr = stage.scheduledDate
    ? new Date(stage.scheduledDate).toLocaleString("en-IN", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "To be confirmed";

  const mailOptions = {
    from: process.env.MAIL_FROM || "AgenticHire <noreply@agentichire.com>",
    to,
    subject: `${icon} Next Round Scheduled — ${jobTitle}`,
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;color:#1a1a1a;">
        <h2 style="margin:0 0 16px;font-size:22px;">You've Been Shortlisted! 🎉</h2>
        <p>Dear <strong>${name || "Candidate"}</strong>,</p>
        <p>
          Congratulations! You have been shortlisted to proceed to the next round
          for the <strong>${jobTitle}</strong> position.
        </p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;background:#f9f9f9;border-radius:8px;">
          <tr>
            <td style="padding:12px 16px;font-weight:bold;width:40%;">Round</td>
            <td style="padding:12px 16px;">${icon} ${stageName}</td>
          </tr>
          <tr style="background:#fff;">
            <td style="padding:12px 16px;font-weight:bold;">Scheduled On</td>
            <td style="padding:12px 16px;">${dateStr}</td>
          </tr>
        </table>
        <p>Please ensure you are available at the scheduled time. Further instructions will be shared closer to the date.</p>
        <p>Good luck!</p>
        <br />
        <p style="margin:0;">Warm regards,<br /><strong>The AgenticHire Team</strong></p>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
}

/**
 * Notify a candidate that they have been shortlisted (generic, after auto-reject).
 */
async function sendShortlistEmail(to, name, jobTitle, rank) {
  if (!to) return;

  const mailOptions = {
    from: process.env.MAIL_FROM || "AgenticHire <noreply@agentichire.com>",
    to,
    subject: `🎉 You've been shortlisted — ${jobTitle}`,
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;color:#1a1a1a;">
        <h2 style="margin:0 0 16px;font-size:22px;">Congratulations, you're shortlisted! 🎉</h2>
        <p>Dear <strong>${name || "Candidate"}</strong>,</p>
        <p>
          We are pleased to inform you that your application for <strong>${jobTitle}</strong>
          has been reviewed and you have been shortlisted${rank ? ` at rank <strong>#${rank}</strong>` : ""}.
        </p>
        <p>You will receive a separate email with the schedule for your next assessment round shortly.</p>
        <p>Best of luck!</p>
        <br />
        <p style="margin:0;">Warm regards,<br /><strong>The AgenticHire Team</strong></p>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
}

export {
  sendRejectionEmail as default,
  sendSchedulingEmail,
  sendShortlistEmail,
};
