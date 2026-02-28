import mongoose from "mongoose";

const roundSchema = new mongoose.Schema(
  {
    roundNumber: { type: Number, required: true },
    roundName: { type: String },
    stageType: { type: String, default: null }, // e.g. "aptitude_test", "technical_interview"
    scheduledDate: { type: Date, default: null }, // auto-filled by scheduler
    score: { type: Number, default: null },
    passed: { type: Boolean, default: null }, // null = not yet decided
    status: {
      type: String,
      enum: ["Pending", "InProgress", "Completed", "Skipped"],
      default: "Pending",
    },
    updatedAt: { type: Date, default: null },
  },
  { _id: false },
);

const InterviewProgressSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JobRole",
      required: true,
    },
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ScreeningCandidate",
      required: true,
    },
    candidateName: { type: String, required: true },
    candidateEmail: { type: String, required: true },
    candidateScore: { type: Number, default: 0 },
    totalRounds: { type: Number, default: 0 },
    rounds: { type: [roundSchema], default: [] },
    status: {
      type: String,
      enum: ["Pending", "InProgress", "Completed"],
      default: "Pending",
    },
    rank: { type: Number, default: null },
  },
  { timestamps: true },
);

InterviewProgressSchema.index({ jobId: 1, candidateId: 1 }, { unique: true });

const InterviewProgress = mongoose.model(
  "InterviewProgress",
  InterviewProgressSchema,
);
export default InterviewProgress;
