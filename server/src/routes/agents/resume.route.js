import express from "express";
import multer from "multer";
import { parseResume } from "../../utils/resumeParser.util.js";
import { analyzeResume } from "../../services/aiService.services.js";

const router = express.Router();

const upload = multer({ dest: "uploads/" });

router.post("/screen", upload.single("resume"), async (req, res) => {
  try {
    const jobDescription = req.body.jobDescription;
    const filePath = req.file.path;

    const resumeText = await parseResume(filePath);
    const result = await analyzeResume(resumeText, jobDescription);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;