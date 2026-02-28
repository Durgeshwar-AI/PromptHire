import express from "express";
import { body, validationResult } from "express-validator";
import Form from "../../models/form.model.js";

const router = express.Router();

// Create a new form submission
router.post(
    "/",
    [
        body("name").notEmpty().withMessage("Name is required"),
        body("email").isEmail().withMessage("Valid email is required"),
        body("phone").notEmpty().withMessage("Phone number is required"),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        try {
            const form = new Form(req.body);
            await form.save();
            res.status(201).json(form);
        } catch (error) {
            res.status(500).json({ message: "Error saving form data", error });
        }
    }
);

export default router;