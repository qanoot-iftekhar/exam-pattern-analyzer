<<<<<<< HEAD
# exam-pattern-analyzer
=======
# Exam Pattern Analyzer

A small local web app: upload previous years' exam papers, and it finds which
questions repeat, ranks them by how likely they are to reappear, and predicts
the top 20 questions for your next exam.

## What it does

- Upload multiple papers (PDF, DOCX, TXT, JPG/PNG) and label each with its year.
- Extracts the text (with OCR for scanned images).
- Sends everything to Claude for analysis, using the same pattern-matching
  logic we discussed: clustering reworded duplicates, sub-part splitting,
  a recency-weighted Repeat Probability Score, topic ranking, and a top-20
  prediction.
- Shows results in tabs (High / Medium / Low probability, Topics, Prediction)
  with color-coded badges.
- Export results as CSV, or "Save as PDF" via your browser's print dialog.

## Requirements

- [Node.js](https://nodejs.org) v18 or newer
- An Anthropic API key — get one at https://console.anthropic.com/

## Setup (in VS Code)

1. Open this folder in VS Code (`File > Open Folder`).
2. Open a terminal (`` Terminal > New Terminal `` or `` Ctrl+` ``).
3. Install dependencies:

   ```
   npm install
   ```

4. Copy the example environment file and add your API key:

   ```
   cp .env.example .env
   ```

   Then open `.env` and paste your key:

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

5. Start the app:

   ```
   npm start
   ```

6. Open your browser to **http://localhost:3000**

That's it — upload a few papers, label their years, and click **Analyze papers**.

## Notes on how it works

- All file parsing (PDF/DOCX/OCR) happens on the server, not in the browser,
  so your API key never reaches the client.
- Each file is capped at ~40,000 characters and the combined upload at
  ~150,000 characters, to stay within the model's context window. If your
  papers are huge, this may truncate some content — you'll see a note about
  it in the results if that happens.
- There's no database in this version — everything is processed in memory
  per request and nothing is saved between sessions. If you want it to
  remember papers across visits, the natural next step is adding a small
  database (e.g. SQLite or Supabase) to store `papers` and `analyses`.
- The model used is `claude-sonnet-5` by default — change `CLAUDE_MODEL` in
  `.env` if you want to try a different one.

## Troubleshooting

- **"No ANTHROPIC_API_KEY found"** — make sure you created `.env` (not just
  `.env.example`) and restarted `npm start` after adding the key.
- **Blank/garbled text from a PDF** — some PDFs are actually scanned images
  with no real text layer; try re-saving it as a JPG/PNG so OCR can pick it
  up, or use a proper scanned-PDF OCR tool first.
- **"AI response could not be parsed as JSON"** — this can happen occasionally
  with very large uploads; try again with fewer files, or split a huge PDF
  into smaller ones.
>>>>>>> 5e88168 (first commit)
