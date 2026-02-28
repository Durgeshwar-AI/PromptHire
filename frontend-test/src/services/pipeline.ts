/* ── Pipeline progress helpers ────────────────────────────────────
   Persists candidate round progress in localStorage so the profile
   page can display a tracker and candidates can resume where they
   left off.
   ─────────────────────────────────────────────────────────────── */

export type RoundStatus = "completed" | "current" | "locked";

export interface PipelineRound {
  key: string;
  label: string;
  icon: string;
  path: string;
  status: RoundStatus;
}

const PIPELINE_KEY = "hr11_pipeline_progress";

const DEFAULT_ROUNDS: Omit<PipelineRound, "status">[] = [
  { key: "resume",        label: "Resume Screening",    icon: "📄", path: "/round/resume-screening" },
  { key: "aptitude",      label: "Aptitude Test",       icon: "🧠", path: "/round/aptitude-test" },
  { key: "coding",        label: "Coding Challenge",    icon: "💻", path: "/round/coding-challenge" },
  { key: "ai-interview",  label: "AI Voice Interview",  icon: "🎙️", path: "/interview-entry" },
  { key: "technical",     label: "Technical Interview", icon: "🔧", path: "/round/technical-interview" },
];

export function getDefaultPipeline(): PipelineRound[] {
  return DEFAULT_ROUNDS.map((r) => ({ ...r, status: "locked" as RoundStatus }));
}

export function loadPipeline(): PipelineRound[] {
  try {
    const raw = localStorage.getItem(PIPELINE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PipelineRound[];
      if (Array.isArray(parsed) && parsed.length === DEFAULT_ROUNDS.length) {
        return parsed;
      }
    }
  } catch { /* fall through */ }
  return getDefaultPipeline();
}

function savePipeline(rounds: PipelineRound[]) {
  localStorage.setItem(PIPELINE_KEY, JSON.stringify(rounds));
}

/**
 * Mark a round as "current" (i.e. the candidate has entered it).
 * All previous rounds stay completed; future rounds stay locked.
 */
export function startRound(roundKey: string): PipelineRound[] {
  const pipeline = loadPipeline();
  const idx = pipeline.findIndex((r) => r.key === roundKey);
  if (idx < 0) return pipeline;

  pipeline.forEach((r, i) => {
    if (i < idx) r.status = "completed";
    else if (i === idx) r.status = "current";
    else r.status = "locked";
  });

  savePipeline(pipeline);
  return pipeline;
}

/**
 * Mark a round as "completed" and advance the next round to "current".
 * If it was the last round, everything is "completed".
 */
export function completeRound(roundKey: string): PipelineRound[] {
  const pipeline = loadPipeline();
  const idx = pipeline.findIndex((r) => r.key === roundKey);
  if (idx < 0) return pipeline;

  pipeline[idx].status = "completed";

  // Advance the next round to "current"
  if (idx + 1 < pipeline.length) {
    pipeline[idx + 1].status = "current";
  }

  savePipeline(pipeline);
  return pipeline;
}

/** Reset pipeline (e.g. for a new application). */
export function resetPipeline(): PipelineRound[] {
  const fresh = getDefaultPipeline();
  savePipeline(fresh);
  return fresh;
}
