import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function analyzeResume(resumeText, jobDescription) {
  const prompt = `
You are an AI HR assistant.

Job Description:
${jobDescription}

Resume:
${resumeText}

Evaluate:
1. Skill match score
2. Missing skills
3. Strengths
4. Experience relevance

Return only the score response in JSON format.
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3
  });

  return JSON.parse(response.choices[0].message.content);
}

export { analyzeResume };