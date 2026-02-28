import { config } from "dotenv";
import app from "./app.js";
import connectDB from "./config/db.js";

config();

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => console.log(`AgenticHire server running on port ${PORT}`));
});

process.on("SIGINT", async () => {
  console.log("Server is shutting down...");
  process.exit(0);
});
