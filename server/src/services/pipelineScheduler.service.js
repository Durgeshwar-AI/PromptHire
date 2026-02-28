/**
 * pipelineScheduler.service.js
 * ────────────────────────────
 * Handles automatic date scheduling for pipeline stages and the cron job
 * that auto-advances candidates through stages once their score is recorded.
 */

import cron from "node-cron";
import JobRole from "../models/JobRole.model.js";
import InterviewProgress from "../models/InterviewProgress.model.js";
import ScreeningCandidate from "../models/candidate.screening.model.js";
import { sendSchedulingEmail } from "./mail.services.js";

// ── Stage icon for notification messages ──────────────────────────
const STAGE_ICONS = {
  resume_screening: "📄",
  aptitude_test: "🧠",
  coding_challenge: "💻",
  ai_voice_interview: "🎙️",
  technical_interview: "⚙️",
  custom_round: "🛠️",
};

/**
 * Auto-assign scheduled dates to every pipeline stage.
 * Uses daysAfterPrev to space stages apart, starting from startDate.
 *
 * @param {Object} job         - Mongoose JobRole document
 * @param {Date|null} startDate - When to start (default: day after submission deadline or today+1)
 * @returns {Promise<Object>} Updated job document
 */
export async function autoSchedulePipeline(job, startDate = null) {
  if (!job.pipeline?.length) {
    throw new Error("Job has no pipeline stages to schedule");
  }

  // Determine the anchor start date
  let current = startDate
    ? new Date(startDate)
    : job.submissionDeadline
      ? new Date(job.submissionDeadline)
      : new Date();

  // Advance one day beyond the anchor to avoid same-day scheduling
  current.setDate(current.getDate() + 1);
  current.setHours(9, 0, 0, 0); // Start at 9 AM

  const updatedPipeline = job.pipeline
    .sort((a, b) => a.order - b.order)
    .map((stage) => {
      const scheduled = new Date(current);
      stage.scheduledDate = scheduled;
      // Advance by daysAfterPrev for the next stage
      current = new Date(current);
      current.setDate(current.getDate() + (stage.daysAfterPrev || 3));
      return stage;
    });

  job.pipeline = updatedPipeline;
  job.schedulingDone = true;
  job.schedulingStartDate = updatedPipeline[0]?.scheduledDate || null;
  await job.save();

  // Sync scheduled dates into all active InterviewProgress records for this job
  await syncScheduledDatesToProgress(job);

  console.log(
    `[PipelineScheduler] Job "${job.title}" (${job._id}) — ${updatedPipeline.length} stages scheduled`,
  );

  return job;
}

/**
 * Update the scheduledDate on every InterviewProgress.rounds entry
 * to match what's now saved in the pipeline.
 */
async function syncScheduledDatesToProgress(job) {
  const progressRecords = await InterviewProgress.find({ jobId: job._id });
  if (!progressRecords.length) return;

  const stageMap = new Map(job.pipeline.map((s) => [s.order, s.scheduledDate]));

  await Promise.all(
    progressRecords.map((progress) => {
      progress.rounds = progress.rounds.map((round) => ({
        ...(round.toObject ? round.toObject() : round),
        scheduledDate: stageMap.get(round.roundNumber) || round.scheduledDate,
      }));
      return progress.save();
    }),
  );
}

/**
 * Advance all shortlisted candidates to the next pipeline stage
 * for jobs whose current stage date has arrived.
 * Runs on a cron schedule.
 */
async function processStageAdvancement() {
  const now = new Date();

  try {
    const activeJobs = await JobRole.find({
      status: "Active",
      schedulingDone: true,
      "pipeline.0": { $exists: true },
    });

    for (const job of activeJobs) {
      const pipeline = job.pipeline.sort((a, b) => a.order - b.order);

      for (const stage of pipeline) {
        if (!stage.scheduledDate || stage.scheduledDate > now) continue;

        // Find progress records where this stage is still Pending
        const pendingProgress = await InterviewProgress.find({
          jobId: job._id,
          [`rounds`]: {
            $elemMatch: {
              roundNumber: stage.order,
              status: "Pending",
            },
          },
        });

        if (!pendingProgress.length) continue;

        console.log(
          `[PipelineScheduler] Job "${job.title}" — activating stage ${stage.order} (${stage.stageType}) for ${pendingProgress.length} candidate(s)`,
        );

        // Mark stage as InProgress for these candidates
        await Promise.all(
          pendingProgress.map(async (progress) => {
            const roundIdx = progress.rounds.findIndex(
              (r) => r.roundNumber === stage.order,
            );
            if (roundIdx === -1) return;

            progress.rounds[roundIdx].status = "InProgress";
            progress.status = "InProgress";
            await progress.save();

            // Notify candidate by email (if mail service supports it)
            try {
              if (typeof sendSchedulingEmail === "function") {
                await sendSchedulingEmail(
                  progress.candidateEmail,
                  progress.candidateName,
                  job.title,
                  stage,
                );
              }
            } catch (mailErr) {
              console.warn(
                `[PipelineScheduler] Email failed for ${progress.candidateEmail}:`,
                mailErr.message,
              );
            }
          }),
        );
      }
    }
  } catch (err) {
    console.error("[PipelineScheduler] Stage advancement error:", err);
  }
}

/**
 * Auto-advance candidates who failed a stage (score below threshold)
 * and mark them as rejected for that job.
 */
export async function processFailedCandidates(jobId, roundNumber) {
  const job = await JobRole.findById(jobId);
  if (!job) return;

  const stage = job.pipeline?.find((s) => s.order === roundNumber);
  const threshold = stage?.thresholdScore ?? 60;

  const progressRecords = await InterviewProgress.find({ jobId });

  const toReject = progressRecords.filter((p) => {
    const round = p.rounds.find((r) => r.roundNumber === roundNumber);
    return round && round.status === "Completed" && round.score < threshold;
  });

  await Promise.all(
    toReject.map(async (progress) => {
      progress.status = "Completed";
      progress.rounds = progress.rounds.map((r) => {
        if (r.roundNumber > roundNumber) {
          return {
            ...(r.toObject ? r.toObject() : r),
            status: "Skipped",
            passed: false,
          };
        }
        return r;
      });
      await progress.save();

      // Also update ScreeningCandidate status
      await ScreeningCandidate.findByIdAndUpdate(progress.candidateId, {
        status: "rejected",
      });

      console.log(
        `[PipelineScheduler] Candidate ${progress.candidateName} failed stage ${roundNumber} (score < ${threshold}) — rejected`,
      );
    }),
  );

  return { rejected: toReject.length };
}

/**
 * Start the cron job that checks every hour if any pipeline stage
 * dates have arrived and advances candidates accordingly.
 */
export function startPipelineAdvancementScheduler() {
  const cronExpr = process.env.PIPELINE_CRON || "30 * * * *"; // every hour at :30
  console.log(
    `[PipelineScheduler] Advancement scheduler started — cron: "${cronExpr}"`,
  );

  // Run once on boot
  processStageAdvancement();

  cron.schedule(cronExpr, () => {
    processStageAdvancement();
  });
}
