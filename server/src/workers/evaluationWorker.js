/**
 * Evaluation Worker
 *
 * Called directly (fire-and-forget) from the conclude endpoint.
 * No Redis or BullMQ required.
 */

import Interview from "../models/Interview.model.js";
import Question from "../models/Question.model.js";
import { callGeminiStandard, parseGeminiJson } from "../services/geminiService.js";
import { buildEvaluatorPrompt } from "../services/promptTemplates.js";

/**
 * Process a single evaluation job.
 */
export async function processEvaluation(interviewId) {
  const interview = await Interview.findById(interviewId).populate("jobId");

  if (!interview) {
    throw new Error(`Interview not found: ${interviewId}`);
  }

  if (!interview.transcript) {
    throw new Error(`No transcript for interview: ${interviewId}`);
  }

  const jobId = interview.jobId?._id || interview.jobId;

  await Interview.findByIdAndUpdate(interviewId, {
    status: "Evaluating",
    evaluationError: null,
  });

  try {
    const questions = await Question.find({ jobId }).sort({ stepNumber: 1 });

    const prompt = buildEvaluatorPrompt(
      interview.transcript,
      questions,
      interview.hintsUsed || []
    );

    const result = await callGeminiStandard(prompt);
    const scores = parseGeminiJson(result);

    const normalizedScores = {
      overallScore: Number(scores.overall_score ?? scores.overallScore ?? 0),
      technicalAccuracy: Number(
        scores.technicalAccuracy ?? scores.technical_accuracy ?? 0
      ),
      communicationScore: Number(
        scores.communicationScore ?? scores.communication_score ?? 0
      ),
      hintRelianceScore: Number(
        scores.hintRelianceScore ?? scores.hint_reliance_score ?? 0
      ),
      questionBreakdown: Array.isArray(scores.questionBreakdown)
        ? scores.questionBreakdown
        : [],
      strengths: Array.isArray(scores.strengths) ? scores.strengths : [],
      weaknesses: Array.isArray(scores.weaknesses) ? scores.weaknesses : [],
    };

    await Interview.findByIdAndUpdate(interviewId, {
      ...normalizedScores,
      evaluationSource: "Gemini",
      status: "Evaluated",
      evaluationError: null,
      evaluatedAt: new Date(),
    });

    console.log(
      `Interview ${interviewId} evaluated by Gemini — score: ${normalizedScores.overallScore}`
    );
    return normalizedScores;
  } catch (error) {
    await Interview.findByIdAndUpdate(interviewId, {
      status: "EvaluationFailed",
      evaluationError: error.message,
      evaluatedAt: new Date(),
    }).catch(() => {});

    throw error;
  }
}
