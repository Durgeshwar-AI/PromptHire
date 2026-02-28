import Groq from "groq-sdk";
import JobRole from "../models/JobRole.model.js";
import Question from "../models/Question.model.js";

let _groq = null;
function getGroq() {
  if (!_groq) {
    if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set");
    _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groq;
}

const SYSTEM_PROMPT = `You are an AI assistant that extracts structured job role data from natural language HR messages sent via WhatsApp.

Parse the message and return ONLY valid JSON (no markdown, no extra text) with this schema:
{
  "title": "string (required) — job title",
  "description": "string — role description inferred from context",
  "skills": ["array", "of", "skill", "strings"],
  "submissionDeadline": "ISO 8601 date string or null if not mentioned",
  "topN": number or null (how many top candidates to keep),
  "totalRounds": number or null (total interview rounds after screening),
  "pipeline": [
    {
      "stageType": "one of: resume_screening | aptitude_test | coding_challenge | ai_voice_interview | technical_interview | custom_round",
      "order": 1,
      "thresholdScore": 60,
      "daysAfterPrev": 3
    }
  ],
  "questions": [
    {
      "text": "question text",
      "level": "Easy | Medium | Hard",
      "keyConceptsExpected": ["array of concepts"]
    }
  ]
}

Pipeline rules:
- "pipeline" should be inferred when the HR mentions stage names like "aptitude", "coding", "technical", "resume screening", "AI interview", "voice interview".
- Stages allowed: resume_screening, aptitude_test, coding_challenge, ai_voice_interview, technical_interview, custom_round.
- A stage can repeat (e.g. two technical rounds). Assign sequential order values.
- If no pipeline is mentioned, return "pipeline" as an empty array.
- "thresholdScore" defaults to 60 unless explicitly stated.
- "daysAfterPrev" defaults to 3 unless a gap is explicitly stated.

General rules:
- If a deadline date is mentioned without a year, assume the current year (2026).
- If "rounds" or "stages" are mentioned by count only (not names), put the count in totalRounds and leave pipeline empty.
- If pipeline stages are named, populate the pipeline array AND set totalRounds to the pipeline length.
- If no questions are explicitly mentioned, return questions as an empty array.
- Skills can be inferred from the job title if not explicitly listed.
- Always return valid JSON. Never include code fences or explanation text.`;

/**
 * Parse a WhatsApp message into structured job creation data.
 * @param {string} message - Raw WhatsApp message text from HR
 * @returns {Promise<Object>} Parsed job data
 */
export async function parseJobFromMessage(message) {
  const groq = getGroq();

  const chat = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Today's date: ${new Date().toISOString().split("T")[0]}\n\nMessage: ${message}`,
      },
    ],
    temperature: 0,
    max_tokens: 1024,
  });

  const raw = chat.choices[0]?.message?.content?.trim() || "{}";

  let parsed;
  try {
    // Strip code fences if the model adds them despite instructions
    const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`AI returned non-JSON output: ${raw.slice(0, 200)}`);
  }

  if (!parsed.title) {
    throw new Error(
      "Could not extract a job title from the message. Please include a job title.",
    );
  }

  return parsed;
}

/**
 * Create a JobRole + optional questions in the database from parsed data.
 * createdByHRId must be a valid HRUser ObjectId.
 */
export async function createJobFromParsed(parsed, createdByHRId) {
  // Normalise pipeline stages if the AI returned them
  const pipeline = Array.isArray(parsed.pipeline)
    ? parsed.pipeline
        .filter((s) => s.stageType)
        .map((s, idx) => ({
          stageType: s.stageType,
          stageName: s.stageName || null,
          order: s.order ?? idx + 1,
          thresholdScore: s.thresholdScore ?? 60,
          daysAfterPrev: s.daysAfterPrev ?? 3,
          scheduledDate: null,
        }))
    : [];

  const computedTotalRounds =
    pipeline.length > 0
      ? pipeline.length
      : parsed.totalRounds != null
        ? Number(parsed.totalRounds)
        : 2;

  const job = await JobRole.create({
    title: parsed.title,
    description: parsed.description || "",
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    createdBy: createdByHRId,
    status: "Active",
    pipeline,
    totalRounds: computedTotalRounds,
    ...(parsed.submissionDeadline && {
      submissionDeadline: new Date(parsed.submissionDeadline),
    }),
    ...(parsed.topN != null && { topN: Number(parsed.topN) }),
  });

  const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  let createdQuestions = [];

  if (questions.length > 0) {
    createdQuestions = await Promise.all(
      questions.map((q, idx) =>
        Question.create({
          jobId: job._id,
          stepNumber: idx + 1,
          text: q.text,
          level: ["Easy", "Medium", "Hard"].includes(q.level)
            ? q.level
            : "Medium",
          keyConceptsExpected: Array.isArray(q.keyConceptsExpected)
            ? q.keyConceptsExpected
            : [],
          maxScore: 10,
          allowFollowUp: true,
        }),
      ),
    );

    await JobRole.findByIdAndUpdate(job._id, {
      totalSteps: createdQuestions.length,
    });
  }

  return { job, questions: createdQuestions };
}

/**
 * Master function: parse message → create in DB → return summary.
 */
export async function handleWhatsAppJobCommand(message, createdByHRId) {
  const parsed = await parseJobFromMessage(message);
  const { job, questions } = await createJobFromParsed(parsed, createdByHRId);

  const deadline = job.submissionDeadline
    ? job.submissionDeadline.toDateString()
    : "Not set";

  const questionLines =
    questions.length > 0
      ? questions.map((q, i) => `  ${i + 1}. [${q.level}] ${q.text}`).join("\n")
      : "  None added";

  const pipelineLines =
    job.pipeline?.length > 0
      ? job.pipeline
          .map((s) => `  ${s.order}. ${s.stageType.replace(/_/g, " ")}`)
          .join("\n")
      : "  Not defined (use ADD PIPELINE)";

  const summary =
    `✅ *Job Created Successfully!*\n\n` +
    `*Title:* ${job.title}\n` +
    `*Skills:* ${job.skills.join(", ") || "N/A"}\n` +
    `*Deadline:* ${deadline}\n` +
    `*Top N candidates:* ${job.topN}\n` +
    `*Interview Rounds:* ${job.totalRounds}\n` +
    `*Pipeline (${job.pipeline?.length ?? 0} stages):*\n${pipelineLines}\n` +
    `*Questions (${questions.length}):*\n${questionLines}\n\n` +
    `*Job ID:* ${job._id}`;

  return { summary, job, questions };
}
