import mongoose from "mongoose";

/**
 * Stores per-stage scores for a candidate across a job's pipeline.
 * One document per (candidateId, jobId) pair — each stage result is an entry.
 */
const stageScoreSchema = new mongoose.Schema(
  {
    roundNumber: { type: Number, required: true },
    stageType: { type: String },
    stageName: { type: String },
    score: { type: Number, min: 0, max: 100, default: null },
    passed: { type: Boolean, default: null },
    evaluatedAt: { type: Date, default: null },
    notes: { type: String, default: "" },
  },
  { _id: false },
);

const candidateScoringSchema = new mongoose.Schema(
  {
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JobRole",
      required: true,
    },
    candidateName: { type: String, default: "" },
    candidateEmail: { type: String, default: "" },
    // Aggregated screening score from resume AI
    screeningScore: { type: Number, default: null },
    // Per-stage scores mirrored from InterviewProgress
    stageScores: { type: [stageScoreSchema], default: [] },
    // Final composite score
    finalScore: { type: Number, default: null },
    recommendation: {
      type: String,
      enum: ["Hire", "Hold", "Reject", null],
      default: null,
    },
  },
  { timestamps: true },
);

candidateScoringSchema.index({ candidateId: 1, jobId: 1 }, { unique: true });

const CandidateScoring = mongoose.model(
  "CandidateScoring",
  candidateScoringSchema,
);
export default CandidateScoring;
