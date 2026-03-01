import express from "express";
import { authenticateCandidate } from "../../middleware/auth.js";
import Interview from "../../models/Interview.model.js";
import Question from "../../models/Question.model.js";
import JobRole from "../../models/JobRole.model.js";
import InterviewCandidate from "../../models/Candidate.model.js";
import {
  DEFAULT_HR_QUESTIONS,
  buildInterviewPrompt,
} from "../../services/interviewQuestions.js";

const router = express.Router();

/**
 * POST /api/interview/token
 * Get an ElevenLabs signed URL for the candidate's AI interview session.
 * Creates or retrieves the Interview record.
 * Returns the signed URL PLUS a systemPrompt and firstMessage so the
 * frontend can pass them as overrides to @11labs/client.
 */
router.post("/token", authenticateCandidate, async (req, res) => {
  try {
    const { jobId, mode = "interview" } = req.body;
    const candidateId = req.candidate.id;

    if (!jobId) {
      return res.status(400).json({ error: "jobId is required" });
    }

    // Upsert Interview record (skip for aptitude rounds)
    let interviewId = null;
    if (mode !== "aptitude") {
      const interview = await Interview.findOneAndUpdate(
        { candidateId, jobId, status: "Scheduled" },
        { status: "InProgress" },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      interviewId = interview._id;
    }

    // ── Gather context for the system prompt ─────────────────────
    // 1. Candidate name
    const candidate = await InterviewCandidate.findById(candidateId).select(
      "name",
    );
    const candidateName = candidate?.name || "Candidate";

    // 2. Job title
    const job = await JobRole.findById(jobId).select("title");
    const jobTitle = job?.title || "the open position";

    // 3. Questions — prefer job-specific from DB, fall back to 20 defaults
    let questions;
    const dbQuestions = await Question.find({ jobId })
      .sort("stepNumber")
      .lean();

    if (dbQuestions.length > 0) {
      questions = dbQuestions.map((q) => ({
        id: q.stepNumber,
        text: q.text,
        category: q.level?.toLowerCase() || "general",
        followUp: q.followUpPrompt || null,
      }));
    } else {
      questions = DEFAULT_HR_QUESTIONS;
    }

    // 4. Build the full system prompt
    const systemPrompt = buildInterviewPrompt(
      candidateName,
      jobTitle,
      questions,
    );
    const firstMessage = `Hi ${candidateName}! Welcome to your interview for the ${jobTitle} position. I'll be asking you a series of questions to learn more about your experience and how you think. Feel free to take your time with each answer. Let's get started! — ${questions[0].text}`;

    // ── Get signed URL from ElevenLabs ───────────────────────────
    const agentId = process.env.ELEVENLABS_AGENT_ID;
    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!agentId || !apiKey) {
      return res.status(500).json({
        error:
          "ElevenLabs credentials not configured. Set ELEVENLABS_AGENT_ID and ELEVENLABS_API_KEY.",
      });
    }

    const elResponse = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
      { headers: { "xi-api-key": apiKey } },
    );

    if (!elResponse.ok) {
      const errBody = await elResponse.text();
      console.error("ElevenLabs signed URL error:", elResponse.status, errBody);
      return res
        .status(502)
        .json({ error: "Failed to get ElevenLabs signed URL" });
    }

    const { signed_url: signedUrl } = await elResponse.json();

    res.json({
      signedUrl,
      agentId,
      interviewId,
      systemPrompt,
      firstMessage,
      questionCount: questions.length,
      metadata: { candidateId, jobId, interviewId, mode },
    });
  } catch (err) {
    console.error("Token generation error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
