import InterviewProgress from "../models/InterviewProgress.model.js";

const STAGE_LABELS = {
  resume_screening: "Resume Screening",
  aptitude_test: "Aptitude Test",
  coding_challenge: "Coding Challenge",
  ai_voice_interview: "AI Voice Interview",
  technical_interview: "Technical Interview",
  custom_round: "Custom Round",
};

/**
 * Build the round skeleton from a job's pipeline stages array.
 * Falls back to totalRounds count if no pipeline defined.
 */
function buildRoundSkeleton(totalRoundsOrJob = 0) {
  // If given a job document, use pipeline stages
  if (
    totalRoundsOrJob &&
    typeof totalRoundsOrJob === "object" &&
    totalRoundsOrJob.pipeline?.length
  ) {
    return totalRoundsOrJob.pipeline
      .sort((a, b) => a.order - b.order)
      .map((stage, idx) => ({
        roundNumber: stage.order ?? idx + 1,
        roundName:
          stage.stageName ||
          STAGE_LABELS[stage.stageType] ||
          `Round ${idx + 1}`,
        stageType: stage.stageType,
        scheduledDate: stage.scheduledDate || null,
        score: null,
        passed: null,
        status: "Pending",
        updatedAt: null,
      }));
  }

  // Fallback: totalRounds is a plain number
  const count = Math.max(Number(totalRoundsOrJob) || 0, 0);
  return Array.from({ length: count }, (_, idx) => ({
    roundNumber: idx + 1,
    roundName: `Round ${idx + 1}`,
    stageType: null,
    scheduledDate: null,
    score: null,
    passed: null,
    status: "Pending",
    updatedAt: null,
  }));
}

async function upsertInterviewProgressRecords(job, candidates = []) {
  if (!job || !candidates.length) return;

  const totalRounds = job.pipeline?.length || job.totalRounds || 0;
  // Pass the whole job so buildRoundSkeleton can use pipeline stages
  const roundTemplate = buildRoundSkeleton(job);

  await Promise.all(
    candidates.map((candidate, idx) =>
      InterviewProgress.updateOne(
        {
          candidateId: candidate._id,
          jobId: job._id,
        },
        {
          $set: {
            candidateName: candidate.name || "Candidate",
            candidateEmail: candidate.email || "",
            candidateScore: candidate._bestScore ?? 0,
            totalRounds,
            ...(candidate._rank
              ? { rank: candidate._rank }
              : { rank: idx + 1 }),
          },
          $setOnInsert: {
            rounds: roundTemplate.map((round) => ({ ...round })),
            status: roundTemplate.length ? "Pending" : "Completed",
          },
        },
        { upsert: true },
      ),
    ),
  );
}

async function getOrCreateProgressDoc({ job, candidateId, candidateSnapshot }) {
  if (!job || !candidateId) return null;

  let progress = await InterviewProgress.findOne({
    jobId: job._id,
    candidateId,
  });

  if (progress) {
    return progress;
  }

  const totalRounds = job.pipeline?.length || job.totalRounds || 0;
  const roundTemplate = buildRoundSkeleton(job);

  progress = await InterviewProgress.create({
    jobId: job._id,
    candidateId,
    candidateName: candidateSnapshot?.name || "Candidate",
    candidateEmail: candidateSnapshot?.email || "",
    candidateScore: candidateSnapshot?._bestScore ?? 0,
    totalRounds,
    rounds: roundTemplate,
    status: roundTemplate.length ? "Pending" : "Completed",
    rank: candidateSnapshot?._rank ?? null,
  });

  return progress;
}

async function updateRoundScore({
  job,
  candidateId,
  candidateSnapshot,
  score,
  roundNumber,
  roundName,
}) {
  if (!job || !candidateId) {
    throw new Error("job and candidateId are required to update round score");
  }

  const progress = await getOrCreateProgressDoc({
    job,
    candidateId,
    candidateSnapshot,
  });

  const rounds = progress.rounds?.length
    ? [...progress.rounds]
    : buildRoundSkeleton(job);

  const idx = (() => {
    if (typeof roundNumber === "number") {
      const normalized = Math.max(roundNumber - 1, 0);
      if (normalized >= rounds.length) {
        while (rounds.length <= normalized) {
          rounds.push({
            roundNumber: rounds.length + 1,
            roundName: `Round ${rounds.length + 1}`,
            stageType: null,
            scheduledDate: null,
            score: null,
            passed: null,
            status: "Pending",
            updatedAt: null,
          });
        }
      }
      return normalized;
    }

    const pendingIndex = rounds.findIndex(
      (round) => round.status !== "Completed",
    );
    if (pendingIndex >= 0) return pendingIndex;

    rounds.push({
      roundNumber: rounds.length + 1,
      roundName: `Round ${rounds.length + 1}`,
      stageType: null,
      scheduledDate: null,
      score: null,
      passed: null,
      status: "Pending",
      updatedAt: null,
    });
    return rounds.length - 1;
  })();

  // Determine pass/fail using pipeline threshold if available
  const pipelineStage = job.pipeline?.find(
    (s) => s.order === (rounds[idx]?.roundNumber ?? idx + 1),
  );
  const threshold = pipelineStage?.thresholdScore ?? 60;
  const passed = typeof score === "number" ? score >= threshold : null;

  rounds[idx] = {
    ...rounds[idx],
    roundNumber: rounds[idx]?.roundNumber ?? idx + 1,
    roundName: roundName || rounds[idx]?.roundName || `Round ${idx + 1}`,
    stageType: rounds[idx]?.stageType ?? null,
    scheduledDate: rounds[idx]?.scheduledDate ?? null,
    score,
    passed,
    status: "Completed",
    updatedAt: new Date(),
  };

  const overallStatus = rounds.every((round) => round.status === "Completed")
    ? "Completed"
    : "InProgress";

  progress.rounds = rounds;
  progress.status = overallStatus;
  await progress.save();

  return progress;
}

export {
  STAGE_LABELS,
  buildRoundSkeleton,
  upsertInterviewProgressRecords,
  updateRoundScore,
};
