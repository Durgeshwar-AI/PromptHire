import express from "express";
import upload from "../../config/multer.js";
import { screenResume } from "../../services/aiService.services.js";
import Candidate from "../../models/candidate.screening.model.js";

const router = express.Router();
router.post("/", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Resume file is required" });
    }

    // Separate known fields from arbitrary HR form data
    const { jobId, source, ...hrFormFields } = req.body;

    const candidate = await Candidate.create({
      resume: {
        url: req.file.path,           // Cloudinary public URL
        cloudinaryId: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
      },
      formData: hrFormFields,          // Whatever HR sent — no schema enforcement
      jobId,
      source,
      status: "pending",
    });

    res.status(201).json({
      message: "Candidate submitted successfully",
      candidateId: candidate._id,
      resumeUrl: candidate.resume.url,
    });
  } catch (err) {
    console.error("Submit candidate error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/screen", async (req, res) => {
  try {
    const { jobTitle, jobDescription } = req.body;

    if (!jobTitle || !jobDescription) {
      return res.status(400).json({ error: "jobTitle and jobDescription are required" });
    }

    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) return res.status(404).json({ error: "Candidate not found" });

    // Run AI screening — passes resume URL so Claude can access it anytime
    const result = await screenResume({
      resumeUrl: candidate.resume.url,
      mimeType: candidate.resume.mimeType,
      jobTitle,
      jobDescription,
      formData: candidate.formData, // HR form context helps Claude score more accurately
    });
    candidate.screeningResults.push(result);
    candidate.status = "screened";
    await candidate.save();

    res.json({
      candidateId: candidate._id,
      screening: result,
    });
  } catch (err) {
    console.error("Screen candidate error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/submit-and-screen", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Resume file is required" });

    const { jobTitle, jobDescription, jobId, source, ...hrFormFields } = req.body;

    if (!jobTitle || !jobDescription) {
      return res.status(400).json({ error: "jobTitle and jobDescription are required" });
    }

    // 1. Save candidate
    const candidate = await Candidate.create({
      resume: {
        url: req.file.path,
        cloudinaryId: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
      },
      formData: hrFormFields,
      jobId,
      source,
      status: "pending",
    });

    // 2. Screen immediately
    const result = await screenResume({
      resumeUrl: candidate.resume.url,
      mimeType: candidate.resume.mimeType,
      jobTitle,
      jobDescription,
      formData: hrFormFields,
    });

    candidate.screeningResults.push(result);
    candidate.status = "screened";
    await candidate.save();

    res.status(201).json({
      candidateId: candidate._id,
      resumeUrl: candidate.resume.url,
      screening: result,
    });
  } catch (err) {
    console.error("Submit and screen error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const { jobId, status, minScore } = req.query;
    const filter = {};

    if (jobId) filter.jobId = jobId;
    if (status) filter.status = status;

    let candidates = await Candidate.find(filter).sort({ createdAt: -1 });

    // Filter by minimum score post-query (score lives inside screeningResults array)
    if (minScore) {
      const min = Number(minScore);
      candidates = candidates.filter((c) =>
        c.screeningResults.some((r) => r.score >= min)
      );
    }

    res.json({ total: candidates.length, candidates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;