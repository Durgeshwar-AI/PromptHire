import express from "express";
import { body, validationResult } from "express-validator";
import { createForm } from "../../controllers/forms.controller.js";

const router = express.Router();

router.post(
  "/",
  [
    body("name").notEmpty().withMessage("Name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("phone").optional().isMobilePhone().withMessage("Valid phone number is required")
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    createForm(req.body, res);
  }
);  

export default router;