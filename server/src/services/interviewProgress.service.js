import InterviewProgress from "../models/InterviewProgress.model.js";

function buildRoundSkeleton(totalRounds = 0) {
  const count = Math.max(Number(totalRounds) || 0, 0);
  return Array.from({ length: count }, (_, idx) => ({
    roundNumber: idx + 1,
    roundName: `Round ${idx + 1}`,
    score: null,
    status: "Pending",
    updatedAt: null,
  }));
}

async function upsertInterviewProgressRecords(job, candidates = []) {
  if (!job || !candidates.length) return;

  const totalRounds = job.totalRounds ?? 0;
  const roundTemplate = buildRoundSkeleton(totalRounds);

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

  const totalRounds = job.totalRounds ?? 0;
  const roundTemplate = buildRoundSkeleton(totalRounds);

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
    : buildRoundSkeleton(job.totalRounds ?? 0);

  const idx = (() => {
    if (typeof roundNumber === "number") {
      const normalized = Math.max(roundNumber - 1, 0);
      if (normalized >= rounds.length) {
        while (rounds.length <= normalized) {
          rounds.push({
            roundNumber: rounds.length + 1,
            roundName: `Round ${rounds.length + 1}`,
            score: null,
            status: "Pending",
            updatedAt: null,
          });
        }
      }
      return normalized;
    }

    const pendingIndex = rounds.findIndex((round) => round.status !== "Completed");
    if (pendingIndex >= 0) return pendingIndex;

    rounds.push({
      roundNumber: rounds.length + 1,
      roundName: `Round ${rounds.length + 1}`,
      score: null,
      status: "Pending",
      updatedAt: null,
    });
    return rounds.length - 1;
  })();

  rounds[idx] = {
    roundNumber: rounds[idx]?.roundNumber ?? idx + 1,
    roundName: roundName || rounds[idx]?.roundName || `Round ${idx + 1}`,
    score,
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

export { buildRoundSkeleton, upsertInterviewProgressRecords, updateRoundScore };
