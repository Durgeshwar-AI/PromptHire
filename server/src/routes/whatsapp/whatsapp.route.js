import express from "express";
import HRUser from "../../models/HRUser.model.js";
import JobRole, { STAGE_TYPES } from "../../models/JobRole.model.js";
import InterviewProgress from "../../models/InterviewProgress.model.js";
import ScreeningCandidate from "../../models/candidate.screening.model.js";
import { createJobFromParsed } from "../../services/whatsappJobCreator.service.js";
import {
  autoSchedulePipeline,
  processFailedCandidates,
} from "../../services/pipelineScheduler.service.js";

const router = express.Router();

// ─── In-memory conversation state for multi-step CREATE JOB ──────
// Key: chatId → { step, data, hrId, expiresAt }
const conversations = new Map();
const CONVERSATION_TTL = 10 * 60 * 1000; // 10 minutes

function getConversation(chatId) {
  const conv = conversations.get(chatId);
  if (!conv) return null;
  if (Date.now() > conv.expiresAt) {
    conversations.delete(chatId);
    return null;
  }
  return conv;
}

function setConversation(chatId, step, data, hrId) {
  conversations.set(chatId, {
    step,
    data,
    hrId,
    expiresAt: Date.now() + CONVERSATION_TTL,
  });
}

function clearConversation(chatId) {
  conversations.delete(chatId);
}

// Clean up expired conversations every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [chatId, conv] of conversations) {
      if (now > conv.expiresAt) conversations.delete(chatId);
    }
  },
  5 * 60 * 1000,
);

// ─── Prefix trigger keyword ──────────────────────────────────────
const TRIGGER_KEYWORD = (
  process.env.TELEGRAM_TRIGGER_KEYWORD || "CREATE JOB"
).toUpperCase();

// ── Stage slug → stageType mapping (allows shorthand) ────────────
const STAGE_ALIASES = {
  resume: "resume_screening",
  "resume screening": "resume_screening",
  aptitude: "aptitude_test",
  "aptitude test": "aptitude_test",
  coding: "coding_challenge",
  "coding challenge": "coding_challenge",
  ai: "ai_voice_interview",
  "ai interview": "ai_voice_interview",
  "ai voice": "ai_voice_interview",
  voice: "ai_voice_interview",
  technical: "technical_interview",
  "technical interview": "technical_interview",
  custom: "custom_round",
};

function resolveStage(raw) {
  const key = raw.trim().toLowerCase();
  return STAGE_ALIASES[key] || (STAGE_TYPES.includes(key) ? key : null);
}

/**
 * Send a Telegram text reply via Bot API.
 * Uses MarkdownV2 parse mode for bold/italic formatting.
 */
async function sendTelegramReply(chatId, text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    console.warn("[Telegram] TELEGRAM_BOT_TOKEN not set — reply skipped");
    return;
  }

  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    console.error("[Telegram] Failed to send reply:", err);
  }
}

// ── Command handlers ─────────────────────────────────────────────

// ── Stage icons for pretty summaries ────────────────────────────
const STAGE_ICONS = {
  resume_screening: "📄",
  aptitude_test: "🧠",
  coding_challenge: "💻",
  ai_voice_interview: "🎙️",
  technical_interview: "⚙️",
  custom_round: "🛠️",
};

async function handleHelp(chatId) {
  await sendTelegramReply(
    chatId,
    `🚀 *PromptHire — Telegram Command Center*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📋 *CREATE JOB* \`<title>\`\n` +
      `   Starts an interactive flow — the bot will ask you for:\n` +
      `   description → skills → deadline → pipeline stages\n` +
      `   ▸ _CREATE JOB Senior React Engineer_\n` +
      `   ▸ _CREATE JOB ML Engineer_\n` +
      `   Send *CANCEL* anytime to abort.\n\n` +
      `🔧 *ADD PIPELINE* \`<job_id>\` stages: \`<s1, s2, …>\`\n` +
      `   Override or set pipeline stages for a job.\n` +
      `   Available: resume · aptitude · coding · ai · technical · custom\n` +
      `   ▸ _ADD PIPELINE 663abc stages: resume, aptitude, technical_\n\n` +
      `📅 *SCHEDULE* \`<job_id>\`\n` +
      `   Auto-assign dates after creating or editing a pipeline.\n\n` +
      `📊 *STATUS* \`<job_id>\`\n` +
      `   View pipeline, scheduled dates & per-stage candidate stats.\n\n` +
      `✅ *SHORTLIST* \`<job_id>\` stage \`<n>\`\n` +
      `   Eliminate candidates who failed stage N; advance the rest.\n\n` +
      `📃 *LIST JOBS*\n` +
      `   Browse all active job openings (up to 10).\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 *Quick tip:* Start with *CREATE JOB*, then *STATUS* to track.\n` +
      `Type */help* anytime to see this menu.`,
  );
}

// ── Multi-step CREATE JOB conversation handler ───────────────────

async function handleCreateJobStep(chatId, rawText, hrId) {
  const upper = rawText.toUpperCase();

  // Cancel at any point
  if (upper === "CANCEL" || upper === "/CANCEL") {
    clearConversation(chatId);
    await sendTelegramReply(chatId, `❌ Job creation cancelled.`);
    return;
  }

  const conv = getConversation(chatId);
  if (!conv) return; // Should not happen, caller checks

  const { step, data } = conv;

  if (step === "awaiting_description") {
    data.description = rawText.trim();
    setConversation(chatId, "awaiting_skills", data, hrId);
    await sendTelegramReply(
      chatId,
      `✅ *Description saved.*\n\n` +
        `🔧 *Step 3/5 — Skills*\n` +
        `Send the required skills, comma-separated.\n\n` +
        `▸ _React, TypeScript, Node.js, MongoDB_\n` +
        `▸ Or send *skip* to auto-detect later.`,
    );
    return;
  }

  if (step === "awaiting_skills") {
    if (upper !== "SKIP") {
      data.skills = rawText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      data.skills = [];
    }
    setConversation(chatId, "awaiting_deadline", data, hrId);
    await sendTelegramReply(
      chatId,
      `✅ *Skills saved:* ${data.skills.length ? data.skills.join(", ") : "_(will be auto-detected)_"}\n\n` +
        `📅 *Step 4/5 — Submission Deadline*\n` +
        `When should applications close?\n\n` +
        `▸ _April 30, 2026_\n` +
        `▸ _2026-04-30_\n` +
        `▸ Or send *skip* for default (14 days from now).`,
    );
    return;
  }

  if (step === "awaiting_deadline") {
    if (upper !== "SKIP") {
      const parsed = new Date(rawText.trim());
      if (isNaN(parsed.getTime())) {
        await sendTelegramReply(
          chatId,
          `❌ Could not parse that date. Try a format like _April 30, 2026_ or _2026-04-30_.\nOr send *skip*.`,
        );
        return;
      }
      data.submissionDeadline = parsed.toISOString();
    } else {
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + 14);
      data.submissionDeadline = deadline.toISOString();
    }
    setConversation(chatId, "awaiting_pipeline", data, hrId);
    await sendTelegramReply(
      chatId,
      `✅ *Deadline:* ${new Date(data.submissionDeadline).toDateString()}\n\n` +
        `📋 *Step 5/5 — Pipeline Stages*\n` +
        `Send the hiring stages in order, comma-separated:\n\n` +
        `Available stages:\n` +
        `  📄 \`resume\` — Resume Screening\n` +
        `  🧠 \`aptitude\` — Aptitude Test\n` +
        `  💻 \`coding\` — Coding Challenge\n` +
        `  🎙️ \`ai\` — AI Voice Interview\n` +
        `  ⚙️ \`technical\` — Technical Interview\n` +
        `  🛠️ \`custom\` — Custom Round\n\n` +
        `▸ _resume, aptitude, coding, technical_\n` +
        `▸ _resume, coding, ai_`,
    );
    return;
  }

  if (step === "awaiting_pipeline") {
    const rawStages = rawText.split(",").map((s) => s.trim());
    const pipeline = rawStages
      .map((s, idx) => {
        const stageType = resolveStage(s);
        if (!stageType) return null;
        const STAGE_NAMES = {
          resume_screening: "Resume Screening",
          aptitude_test: "Aptitude Test",
          coding_challenge: "Coding Challenge",
          ai_voice_interview: "AI Voice Interview",
          technical_interview: "Technical Interview",
          custom_round: "Custom Round",
        };
        return {
          stageType,
          stageName: STAGE_NAMES[stageType] || stageType.replace(/_/g, " "),
          order: idx + 1,
          thresholdScore: 60,
          daysAfterPrev: 3,
        };
      })
      .filter(Boolean);

    if (!pipeline.length) {
      await sendTelegramReply(
        chatId,
        `❌ No valid stages found. Valid: resume, aptitude, coding, ai, technical, custom\nTry again or send *CANCEL*.`,
      );
      return;
    }

    data.pipeline = pipeline;
    data.totalRounds = pipeline.length;
    data.topN = data.topN || 5;
    clearConversation(chatId);

    // ── Create the job ────────────────────────────────────────
    try {
      const { job } = await createJobFromParsed(data, hrId);

      // Auto-schedule pipeline dates
      let scheduledJob = job;
      if (job.pipeline?.length > 0) {
        try {
          await autoSchedulePipeline(job, job.submissionDeadline);
          scheduledJob = await JobRole.findById(job._id);
        } catch (schedErr) {
          console.warn("[JobCreator] Auto-schedule failed:", schedErr.message);
        }
      }

      // Build summary
      const deadline = scheduledJob.submissionDeadline
        ? scheduledJob.submissionDeadline.toDateString()
        : "Not set";

      const pipelineLines =
        scheduledJob.pipeline
          ?.sort((a, b) => a.order - b.order)
          .map((s) => {
            const icon = STAGE_ICONS[s.stageType] || "▪️";
            const name = s.stageName || s.stageType.replace(/_/g, " ");
            const date = s.scheduledDate
              ? new Date(s.scheduledDate).toDateString()
              : "TBD";
            return `  ${icon} ${s.order}. ${name} — ${date}`;
          })
          .join("\n") || "  None";

      await sendTelegramReply(
        chatId,
        `✅ *Job Created & Pipeline Deployed!*\n\n` +
          `*Title:* ${scheduledJob.title}\n` +
          `*Description:* ${scheduledJob.description || "—"}\n` +
          `*Skills:* ${scheduledJob.skills?.join(", ") || "N/A"}\n` +
          `*Deadline:* ${deadline}\n\n` +
          `📋 *Hiring Pipeline (${scheduledJob.pipeline?.length ?? 0} stages):*\n${pipelineLines}\n\n` +
          `*Job ID:* \`${scheduledJob._id}\`\n` +
          `*Status:* ${scheduledJob.status} | *Scheduling:* ✅ Done`,
      );
    } catch (createErr) {
      console.error("[Telegram] Job creation error:", createErr.message);
      await sendTelegramReply(
        chatId,
        `❌ Failed to create job: ${createErr.message}`,
      );
    }
    return;
  }
}

async function handleAddPipeline(chatId, rawText) {
  const jobMatch = rawText.match(/add\s+pipeline\s+([a-f0-9]{24})/i);
  const stagesMatch = rawText.match(/stages?\s*:\s*(.+)/i);

  if (!jobMatch || !stagesMatch) {
    await sendTelegramReply(
      chatId,
      `❌ Format: *ADD PIPELINE <job\\_id> stages: resume, aptitude, coding, technical*\n` +
        `Use STATUS <job\\_id> to get IDs. Send HELP for docs.`,
    );
    return;
  }

  const jobId = jobMatch[1];
  const rawStages = stagesMatch[1].split(",").map((s) => s.trim());
  const pipeline = rawStages
    .map((s, idx) => {
      const stageType = resolveStage(s);
      return stageType
        ? { stageType, order: idx + 1, thresholdScore: 60, daysAfterPrev: 3 }
        : null;
    })
    .filter(Boolean);

  if (!pipeline.length) {
    await sendTelegramReply(
      chatId,
      `❌ No valid stages found. Valid: resume, aptitude, coding, ai, technical, custom`,
    );
    return;
  }

  const job = await JobRole.findById(jobId);
  if (!job) {
    await sendTelegramReply(chatId, `❌ Job ID "${jobId}" not found.`);
    return;
  }

  job.pipeline = pipeline;
  job.totalRounds = pipeline.length;
  job.schedulingDone = false;
  await job.save();

  const list = pipeline
    .map((s, i) => `  ${i + 1}. ${s.stageType.replace(/_/g, " ")}`)
    .join("\n");

  await sendTelegramReply(
    chatId,
    `✅ *Pipeline saved for "${job.title}"*\n\n${list}\n\n` +
      `📅 Next: *SCHEDULE ${job._id}* to auto-assign dates.`,
  );
}

async function handleSchedule(chatId, rawText) {
  const idMatch = rawText.match(/schedule\s+([a-f0-9]{24})/i);
  if (!idMatch) {
    await sendTelegramReply(chatId, `❌ Format: *SCHEDULE <job\\_id>*`);
    return;
  }

  const job = await JobRole.findById(idMatch[1]);
  if (!job) {
    await sendTelegramReply(chatId, `❌ Job not found.`);
    return;
  }
  if (!job.pipeline?.length) {
    await sendTelegramReply(
      chatId,
      `❌ No pipeline on "${job.title}".\nRun: *ADD PIPELINE ${job._id} stages: resume, technical* first.`,
    );
    return;
  }

  await autoSchedulePipeline(job, job.submissionDeadline);
  const updated = await JobRole.findById(job._id);

  const lines = updated.pipeline
    .sort((a, b) => a.order - b.order)
    .map((s) => {
      const d = s.scheduledDate
        ? new Date(s.scheduledDate).toDateString()
        : "TBD";
      const name = s.stageName || s.stageType.replace(/_/g, " ");
      return `  ${s.order}. ${name} → ${d}`;
    })
    .join("\n");

  await sendTelegramReply(
    chatId,
    `📅 *Pipeline scheduled for "${updated.title}"*\n\n${lines}\n\n` +
      `Candidates will be notified when each stage opens.`,
  );
}

async function handleStatus(chatId, rawText) {
  const idMatch = rawText.match(/status\s+([a-f0-9]{24})/i);
  if (!idMatch) {
    await sendTelegramReply(chatId, `❌ Format: *STATUS <job\\_id>*`);
    return;
  }

  const job = await JobRole.findById(idMatch[1]);
  if (!job) {
    await sendTelegramReply(chatId, `❌ Job not found.`);
    return;
  }

  const [total, shortlisted, progressRecords] = await Promise.all([
    ScreeningCandidate.countDocuments({ jobId: job._id }),
    ScreeningCandidate.countDocuments({
      jobId: job._id,
      status: "shortlisted",
    }),
    InterviewProgress.find({ jobId: job._id }),
  ]);

  let pipelineText = "  _(no pipeline defined)_";
  if (job.pipeline?.length) {
    pipelineText = job.pipeline
      .sort((a, b) => a.order - b.order)
      .map((s) => {
        const d = s.scheduledDate
          ? new Date(s.scheduledDate).toDateString()
          : "Not scheduled";
        const name = s.stageName || s.stageType.replace(/_/g, " ");
        const active = progressRecords.filter((p) =>
          p.rounds.find(
            (r) => r.roundNumber === s.order && r.status === "InProgress",
          ),
        ).length;
        const done = progressRecords.filter((p) =>
          p.rounds.find(
            (r) => r.roundNumber === s.order && r.status === "Completed",
          ),
        ).length;
        return `  ${s.order}. ${name}\n     📅 ${d} | 🔵 ${active} active | ✅ ${done} done`;
      })
      .join("\n");
  }

  await sendTelegramReply(
    chatId,
    `📊 *${job.title}*\n` +
      `ID: ${job._id}\n` +
      `Status: ${job.status} | Deadline: ${job.submissionDeadline ? new Date(job.submissionDeadline).toDateString() : "None"}\n` +
      `Applicants: ${total} | Shortlisted: ${shortlisted}\n\n` +
      `*Pipeline:*\n${pipelineText}`,
  );
}

async function handleShortlist(chatId, rawText) {
  const match = rawText.match(/shortlist\s+([a-f0-9]{24})\s+stage\s+(\d+)/i);
  if (!match) {
    await sendTelegramReply(
      chatId,
      `❌ Format: *SHORTLIST <job\\_id> stage <number>*`,
    );
    return;
  }

  const result = await processFailedCandidates(
    match[1],
    parseInt(match[2], 10),
  );
  await sendTelegramReply(
    chatId,
    `✅ Stage ${match[2]} shortlisting complete.\n` +
      `${result?.rejected ?? 0} candidate(s) eliminated (score below threshold).\n` +
      `Passing candidates advance to the next round.`,
  );
}

async function handleListJobs(chatId, hrId) {
  const jobs = await JobRole.find({ status: "Active" })
    .sort({ createdAt: -1 })
    .limit(10)
    .select("title pipeline status submissionDeadline createdAt");

  if (!jobs.length) {
    await sendTelegramReply(
      chatId,
      `📭 No active jobs found. Send *CREATE JOB* to create one.`,
    );
    return;
  }

  const lines = jobs
    .map((j, i) => {
      const deadline = j.submissionDeadline
        ? new Date(j.submissionDeadline).toDateString()
        : "No deadline";
      const stages = j.pipeline?.length || 0;
      return `${i + 1}. *${j.title}*\n   📅 ${deadline} | 🔧 ${stages} stages\n   ID: \`${j._id}\``;
    })
    .join("\n\n");

  await sendTelegramReply(
    chatId,
    `📋 *Active Job Openings (${jobs.length})*\n\n${lines}\n\n` +
      `Use *STATUS <job\\_id>* to see details.`,
  );
}

// ── POST /api/telegram/webhook — Telegram Bot webhook ────────────
router.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately

  try {
    const update = req.body;

    // Telegram sends updates with a "message" field
    const msg = update?.message;
    if (!msg || !msg.text) return;

    const chatId = msg.chat.id;
    const telegramUserId = msg.from?.id?.toString();
    const rawText = msg.text.trim();
    const upper = rawText.toUpperCase();

    // Resolve HR user by Telegram user ID
    const hrUser = await HRUser.findOne({ telegramUserId });
    const fallbackHRId = process.env.TELEGRAM_DEFAULT_HR_ID;

    if (!hrUser && !fallbackHRId) {
      await sendTelegramReply(
        chatId,
        "❌ Your Telegram account is not linked to any HR account. Ask admin to register it.",
      );
      return;
    }

    const createdByHRId = hrUser?._id?.toString() || fallbackHRId;

    // ── Check if we're mid-conversation (multi-step CREATE JOB) ──
    const activeConv = getConversation(chatId);
    if (activeConv && upper !== "CANCEL" && upper !== "/CANCEL") {
      // If user typed a different command mid-conversation, warn them
      const isCommand =
        upper.startsWith("/") ||
        upper.startsWith("CREATE JOB") ||
        upper === "HELP" ||
        upper.startsWith("LIST") ||
        upper.startsWith("ADD PIPELINE") ||
        upper.startsWith("SCHEDULE") ||
        upper.startsWith("STATUS") ||
        upper.startsWith("SHORTLIST");
      if (isCommand) {
        await sendTelegramReply(
          chatId,
          `⚠️ You have an active job creation in progress (*${activeConv.data.title}*).\n\n` +
            `Send your response to continue, or send *CANCEL* to abort it first.`,
        );
        return;
      }
      // Continue the conversation
      try {
        await handleCreateJobStep(chatId, rawText, createdByHRId);
      } catch (stepErr) {
        console.error("[Telegram] Conversation step error:", stepErr.message);
        clearConversation(chatId);
        await sendTelegramReply(
          chatId,
          `❌ Error: ${stepErr.message}\nJob creation aborted. Send /help for usage.`,
        );
      }
      return;
    }

    // Handle CANCEL even outside conversation
    if (upper === "CANCEL" || upper === "/CANCEL") {
      if (activeConv) {
        clearConversation(chatId);
        await sendTelegramReply(chatId, `❌ Job creation cancelled.`);
      } else {
        await sendTelegramReply(chatId, `ℹ️ Nothing to cancel.`);
      }
      return;
    }

    try {
      if (
        upper === "/HELP" ||
        upper === "HELP" ||
        upper === "/START" ||
        upper === "?"
      ) {
        await handleHelp(chatId);
      } else if (
        upper.startsWith("LIST JOBS") ||
        upper.startsWith("/LIST") ||
        upper.startsWith("/JOBS")
      ) {
        await handleListJobs(chatId, createdByHRId);
      } else if (
        upper.startsWith("ADD PIPELINE") ||
        upper.startsWith("/ADD_PIPELINE")
      ) {
        await handleAddPipeline(
          chatId,
          rawText.replace(/^\/add_pipeline\s*/i, "ADD PIPELINE "),
        );
      } else if (
        upper.startsWith("SCHEDULE") ||
        upper.startsWith("/SCHEDULE")
      ) {
        await handleSchedule(
          chatId,
          rawText.replace(/^\/schedule\s*/i, "SCHEDULE "),
        );
      } else if (upper.startsWith("STATUS") || upper.startsWith("/STATUS")) {
        await handleStatus(chatId, rawText.replace(/^\/status\s*/i, "STATUS "));
      } else if (
        upper.startsWith("SHORTLIST") ||
        upper.startsWith("/SHORTLIST")
      ) {
        await handleShortlist(
          chatId,
          rawText.replace(/^\/shortlist\s*/i, "SHORTLIST "),
        );
      } else if (
        upper.startsWith(TRIGGER_KEYWORD) ||
        upper.startsWith("/CREATE_JOB") ||
        upper.startsWith("/CREATEJOB")
      ) {
        const title = rawText
          .replace(/^\/create_?job\s*/i, "")
          .replace(new RegExp(`^${TRIGGER_KEYWORD}\\s*`, "i"), "")
          .trim();
        if (!title) {
          await sendTelegramReply(
            chatId,
            `📋 *CREATE JOB* needs a job title.\n\n` +
              `▸ _CREATE JOB Senior React Engineer_\n` +
              `▸ _CREATE JOB ML Engineer_\n\n` +
              `The bot will then ask you step-by-step for description, skills, deadline & pipeline.`,
          );
          return;
        }
        // Start interactive conversation
        setConversation(
          chatId,
          "awaiting_description",
          { title },
          createdByHRId,
        );
        await sendTelegramReply(
          chatId,
          `✅ *Job title:* ${title}\n\n` +
            `📝 *Step 2/5 — Job Description*\n` +
            `Send the full job description now.\n\n` +
            `▸ _We are looking for a senior engineer with 3+ years of React experience…_\n\n` +
            `Send *CANCEL* anytime to abort.`,
        );
      } else {
        await sendTelegramReply(
          chatId,
          `❓ Unknown command. Send /help to see all options.`,
        );
      }
    } catch (cmdErr) {
      console.error("[Telegram] Command error:", cmdErr.message);
      await sendTelegramReply(
        chatId,
        `❌ Error: ${cmdErr.message}\n\nSend /help for usage guide.`,
      );
    }
  } catch (err) {
    console.error("[Telegram] Webhook processing error:", err);
  }
});

// ── POST /api/telegram/setup — Register webhook with Telegram ────
router.post("/setup", async (req, res) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const webhookUrl = req.body.webhookUrl || process.env.TELEGRAM_WEBHOOK_URL;

  if (!botToken) {
    return res.status(400).json({ error: "TELEGRAM_BOT_TOKEN not set" });
  }
  if (!webhookUrl) {
    return res.status(400).json({
      error: "Provide webhookUrl in body or set TELEGRAM_WEBHOOK_URL env var",
    });
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: `${webhookUrl}/api/telegram/webhook` }),
      },
    );
    const data = await response.json();

    if (data.ok) {
      console.log(
        "[Telegram] Webhook registered successfully:",
        data.description,
      );
      res.json({ success: true, description: data.description });
    } else {
      console.error(
        "[Telegram] Webhook registration failed:",
        data.description,
      );
      res.status(400).json({ error: data.description });
    }
  } catch (err) {
    console.error("[Telegram] Setup error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/telegram/status — Check webhook status ──────────────
router.get("/status", async (req, res) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return res.status(400).json({ error: "TELEGRAM_BOT_TOKEN not set" });
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/getWebhookInfo`,
    );
    const data = await response.json();
    res.json(data.result || data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
