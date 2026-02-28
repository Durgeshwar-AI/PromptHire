/**
 * Assessment Link Generator
 * ─────────────────────────
 * Maps pipeline stageType → candidate-facing assessment URL.
 * Used by the mail service and the pipeline scheduler to send
 * direct, clickable assessment links to candidates.
 */

const FRONTEND_BASE = process.env.FRONTEND_URL || "http://localhost:5173";

/**
 * Frontend route path for each stage type.
 */
const STAGE_ROUTE_MAP = {
  resume_screening: "/round/resume-screening",
  aptitude_test: "/round/aptitude-test",
  coding_challenge: "/round/coding-challenge",
  ai_voice_interview: "/round/ai-interview",
  technical_interview: "/round/technical-interview",
  custom_round: null, // no generic link for custom rounds
};

/**
 * Build a fully-qualified assessment link for a candidate.
 *
 * @param {Object} opts
 * @param {string} opts.stageType     – Pipeline stage type
 * @param {string} opts.jobId         – Job ObjectId
 * @param {string} opts.candidateId   – Candidate (ScreeningCandidate) ObjectId
 * @param {number} [opts.roundNumber] – Pipeline round number (for context)
 * @returns {string|null} Full URL or null if stageType has no link
 */
export function buildAssessmentLink({
  stageType,
  jobId,
  candidateId,
  roundNumber,
}) {
  const route = STAGE_ROUTE_MAP[stageType];
  if (!route) return null;

  const params = new URLSearchParams();
  if (jobId) params.set("jobId", String(jobId));
  if (candidateId) params.set("candidateId", String(candidateId));
  if (roundNumber != null) params.set("round", String(roundNumber));

  return `${FRONTEND_BASE}${route}?${params.toString()}`;
}

/**
 * Human-readable label for a stage type.
 */
export const STAGE_LABELS = {
  resume_screening: "Resume Screening",
  aptitude_test: "Aptitude Test",
  coding_challenge: "Coding Challenge",
  ai_voice_interview: "AI Voice Interview",
  technical_interview: "Technical Interview",
  custom_round: "Custom Round",
};

/**
 * Emoji icon for each stage type.
 */
export const STAGE_ICONS = {
  resume_screening: "📄",
  aptitude_test: "🧠",
  coding_challenge: "💻",
  ai_voice_interview: "🎙️",
  technical_interview: "⚙️",
  custom_round: "🛠️",
};
