import express from "express";
import { authenticateCandidate } from "../../middleware/auth.js";
import Interview from "../../models/Interview.model.js";

const router = express.Router();

/**
 * POST /api/interview/token
 * Get an ElevenLabs signed URL for the candidate's AI interview session.
 * Creates or retrieves the Interview record.
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

    // Fetch a signed URL from ElevenLabs Conversational AI API
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
      metadata: { candidateId, jobId, interviewId, mode },
    });
  } catch (err) {
    console.error("Token generation error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
