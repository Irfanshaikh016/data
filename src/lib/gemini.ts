import type { CopilotContext } from "@/lib/copilot";
import type { GoalSpec } from "@/lib/types";

export async function askGemini(
  userMessage: string,
  context: CopilotContext | null,
  goal: GoalSpec | null
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    let datasetSummary = "No dataset currently loaded.";
    if (context) {
      const colDetails = context.columns
        .slice(0, 30)
        .map(
          (c) =>
            `- "${c.name}" (${c.dtype}): ${c.nulls} nulls (${c.nullPct}%), ${c.unique} unique values, sample: [${c.sample.map((s) => `"${s}"`).join(", ")}]`
        )
        .join("\n");

      datasetSummary = `
Dataset Name: ${context.name}
Total Rows: ${context.totalRows.toLocaleString()}
Total Columns: ${context.columns.length}
Duplicate Rows: ${context.dupes.toLocaleString()}
Active Cleaning Recipe Steps: ${context.recipeLen} steps applied
Columns Profile:
${colDetails}
${goal ? `User's Stated Goal: "${goal.raw}" (Detected Task: ${goal.task}, Target Column: ${goal.target ?? "none"})` : "User's Stated Goal: None stated yet"}
`;
    }

    const systemPrompt = `You are CleanGrid AI Co-pilot, an expert data scientist and tabular data cleaning assistant.
You help users inspect, clean, and prepare tabular datasets for machine learning and analytics.
You have real-time metadata of the user's currently loaded dataset:
${datasetSummary}

Instructions:
1. Provide concise, direct, and actionable data cleaning advice based on the actual numbers in this dataset.
2. If the user asks about null values, outliers, data types, anomalies, or preparation for models (like classification or regression), reference their specific column names and statistics.
3. Be friendly, sharp, and concise. Avoid unnecessary preamble. Use clean markdown formatting with bullet points where helpful.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: userMessage }],
          },
        ],
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024,
        },
      }),
    });

    if (!res.ok) {
      // Try gemini-1.5-flash as fallback if gemini-2.5-flash is not enabled on the key
      const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const resFallback = await fetch(fallbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\nUser Question: ${userMessage}` }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
        }),
      });
      if (resFallback.ok) {
        const fbData = await resFallback.json();
        const text = fbData?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text === "string" && text.trim()) return text.trim();
      }
      return null;
    }

    const data = await res.json();
    const candidate = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
  } catch (err) {
    console.warn("[gemini] Error calling Gemini API:", err instanceof Error ? err.message : err);
    return null;
  }
}
