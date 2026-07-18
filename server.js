require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const Tesseract = require('tesseract.js');

const PORT = process.env.PORT || 3000;
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const MAX_CHARS_PER_DOC = 40000;   // guardrail per file
const MAX_CHARS_TOTAL = 150000;    // guardrail across all files combined

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 }
});

let anthropic = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

const SYSTEM_PROMPT = `You are an expert Exam Question Pattern Analyzer. Your job is to help
students revise smarter by finding which questions and topics repeat across
previous years' exam papers.

INPUT: You will receive extracted text from multiple exam papers. Each
paper's text is preceded by a header line like:
=== YEAR: 2022 | FILE: midterm.pdf ===
If a year looks missing or unclear in the header, treat that document's
year as "Unknown" rather than guessing.

PROCESS (work through this silently, then output only the final JSON):
1. Extract every actual question from each paper. Ignore page numbers,
   headers, footers, general instructions, marks distribution, and
   formatting differences.
2. Split multi-part questions into sub-parts (e.g. 1a, 1b, 1c) and treat
   each sub-part as its own item.
3. Normalize wording - strip filler words, standardize command verbs
   (define/explain/discuss/differentiate), and treat reworded or
   reordered questions covering the same concept as the same question.
4. Cluster semantically identical or near-identical questions across all
   papers, even when phrasing, examples, or numbers differ.
5. For each cluster: count occurrences and list every year it appeared in.
6. Calculate a Repeat Probability Score (0-100) using both frequency
   (years appeared / years uploaded) and recency (weight recent years
   more heavily than older ones).
7. Rank all clusters from most to least repeated.
8. Identify the topics/chapters that appear most frequently overall.
9. Predict up to 20 questions most likely to appear next - mostly from
   high-probability clusters, plus a few important topics that are due
   for a repeat based on the pattern.
10. If fewer than 3 distinct years are present, add a note saying
    predictions are based on limited data rather than presenting them as
    fully reliable.

STRICT OUTPUT RULES:
- Respond with ONLY valid JSON. No markdown code fences, no commentary,
  no text before or after the JSON.
- Never invent a year, filename, or occurrence that isn't actually present
  in the input.
- Keep "question" strings concise (one line, no sub-bullets inside them).
- Match this exact shape:

{
  "highProbability": [
    { "question": "string", "appeared": 0, "years": ["string"], "probability": 0 }
  ],
  "mediumProbability": [
    { "question": "string", "appeared": 0, "years": ["string"], "probability": 0 }
  ],
  "lowProbability": [
    { "question": "string", "appeared": 0, "years": ["string"], "probability": 0 }
  ],
  "importantTopics": ["string"],
  "examPrediction": [
    { "question": "string", "reason": "string" }
  ],
  "notes": ["string"]
}

- highProbability = probability 80-100, mediumProbability = 50-79,
  lowProbability = below 50.
- If there isn't enough data for a category, return an empty array for it
  (not a fabricated entry).`;

function extToKind(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (ext === '.txt') return 'txt';
  if (['.jpg', '.jpeg', '.png'].includes(ext)) return 'image';
  return 'unsupported';
}

async function extractText(file) {
  const kind = extToKind(file.originalname);
  try {
    if (kind === 'pdf') {
      const data = await pdfParse(file.buffer);
      const extracted = (data.text || '').trim();
      if (extracted.length < 30) {
        return {
          text: '',
          error: `${file.originalname} looks like a scanned/photocopied PDF with no real text layer (only ${extracted.length} characters found). Convert its pages to JPG/PNG images and upload those instead so OCR can read them.`
        };
      }
      return { text: data.text, error: null };
    }
    if (kind === 'docx') {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return { text: result.value || '', error: null };
    }
    if (kind === 'txt') {
      return { text: file.buffer.toString('utf-8'), error: null };
    }
    if (kind === 'image') {
      const { data } = await Tesseract.recognize(file.buffer, 'eng');
      return { text: data.text || '', error: null };
    }
    return { text: '', error: `Unsupported file type: ${file.originalname}` };
  } catch (err) {
    return { text: '', error: `Could not read ${file.originalname}: ${err.message}` };
  }
}

function stripCodeFences(text) {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  }
  return t.trim();
}

app.post('/api/analyze', upload.array('files', 20), async (req, res) => {
  try {
    const client = getClient();
    if (!client) {
      return res.status(400).json({
        success: false,
        error: 'No ANTHROPIC_API_KEY found. Add it to your .env file and restart the server.'
      });
    }

    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files were uploaded.' });
    }

    let years = [];
    try {
      years = JSON.parse(req.body.years || '[]');
    } catch (_) {
      years = [];
    }

    const extractionErrors = [];
    const skippedFiles = [];
    const docBlocks = [];
    let totalChars = 0;
    let limitReached = false;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (limitReached) {
        skippedFiles.push(file.originalname);
        continue;
      }

      const year = (years[i] && String(years[i]).trim()) || 'Unknown';
      const { text, error } = await extractText(file);
      if (error) extractionErrors.push(error);

      let clean = text.replace(/\s+\n/g, '\n').trim();
      if (clean.length > MAX_CHARS_PER_DOC) {
        clean = clean.slice(0, MAX_CHARS_PER_DOC) + '\n[...truncated...]';
      }

      if (totalChars + clean.length > MAX_CHARS_TOTAL) {
        const remaining = Math.max(0, MAX_CHARS_TOTAL - totalChars);
        clean = clean.slice(0, remaining) + '\n[...truncated: overall size limit reached...]';
        limitReached = true;
      }
      totalChars += clean.length;

      docBlocks.push(`=== YEAR: ${year} | FILE: ${file.originalname} ===\n${clean}`);
    }

    const combinedText = docBlocks.join('\n\n');

    if (!combinedText.trim() || totalChars === 0) {
      console.log('Extraction errors:', extractionErrors);
      return res.status(400).json({
        success: false,
        error: extractionErrors.length
          ? `Could not extract any readable text. Details: ${extractionErrors.join(' | ')}`
          : 'Could not extract any readable text. The file may be a scanned image with no real text layer, or an unsupported format.',
        extractionErrors
      });
    }

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: combinedText }]
    });

    const rawText = (message.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    let data;
    try {
      data = JSON.parse(stripCodeFences(rawText));
    } catch (err) {
      return res.status(502).json({
        success: false,
        error: 'The AI response could not be parsed as JSON. Try again, or with fewer files.',
        raw: rawText.slice(0, 2000)
      });
    }

    data.notes = Array.isArray(data.notes) ? data.notes : [];
    if (extractionErrors.length) {
      data.notes.push(...extractionErrors.map((e) => `Extraction issue: ${e}`));
    }
    if (limitReached && docBlocks.length) {
      data.notes.push('Some content was truncated to fit within processing limits; results may be incomplete.');
    }
    if (skippedFiles.length) {
      data.notes.push(`These files were skipped because the combined upload was too large: ${skippedFiles.join(', ')}. Try analyzing them in a separate, smaller batch.`);
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message || 'Unexpected server error.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY) });
});

app.listen(PORT, () => {
  console.log(`Exam Pattern Analyzer running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('Warning: ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
});
