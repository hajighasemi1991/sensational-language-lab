require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || 'gpt-5-nano';

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const allowedExtensions = new Set(['.pdf', '.doc', '.docx', '.txt']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.has(ext)) return cb(new Error('Please upload a PDF, DOC, DOCX, or TXT file.'));
    cb(null, true);
  }
});

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { sensationalized_text: { type: 'string' } },
  required: ['sensationalized_text']
};

function mimeFor(filename, fallback = 'application/octet-stream') {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain'
  };
  return map[ext] || fallback;
}

function menuPrompt() {
  return `You are a food-menu rewriting assistant applying a research-defined form of sensational language.

DEFINITION
Sensational language is dramatic, emotionally evocative, affective-evaluative wording that frames food as a pleasurable, indulgent experience rather than as a neutral list of attributes or ingredients. It is distinct from merely descriptive, sensory, or vivid language. Do not treat added sensory detail by itself as the goal.

REFERENCE EXAMPLE
Neutral: "Spaghetti, tomato sauce, garlic, basil, parmesan."
Sensational: "Golden spaghetti twirls through a rich tomato embrace, garlic sparks the flavor, basil adds a fresh lift, and parmesan crowns it with irresistible delight."

TASK
- The input is a menu that includes ingredient lists or ingredient descriptions.
- Return the FULL menu text.
- Rewrite ONLY the ingredient lists and ingredient-description portions using sensational language as defined above.
- Keep everything else the same: item names, section headings, prices, quantities, dietary markers, labels, ordering, and all other non-ingredient text.
- Preserve the underlying dish and every stated ingredient.
- Do not add, remove, replace, or invent ingredients.
- Do not invent factual claims such as fresh, local, organic, handmade, premium, award-winning, healthy, authentic, imported, aged, or rare unless the source explicitly states them.
- Use dramatic and emotionally evocative phrasing where natural, including affective evaluation, metaphor, personification, or experiential framing.
- Do not simply turn the text into a sensory description.
- Correct grammar and punctuation within the rewritten ingredient text when appropriate.
- Preserve the original language of the menu.
- Do not explain your changes. Return only the transformed menu in the structured output field.`;
}

function productPrompt() {
  return `You are a food-language rewriting assistant applying a research-defined form of sensational language.

DEFINITION
Sensational language is dramatic, emotionally evocative, affective-evaluative wording that frames food as a pleasurable, indulgent experience rather than as a neutral list of attributes or ingredients. It is distinct from merely descriptive, sensory, or vivid language. Do not treat added sensory detail by itself as the goal.

REFERENCE EXAMPLE
Neutral: "Spaghetti, tomato sauce, garlic, basil, parmesan."
Sensational: "Golden spaghetti twirls through a rich tomato embrace, garlic sparks the flavor, basil adds a fresh lift, and parmesan crowns it with irresistible delight."

TASK
- Rewrite the full supplied text for ONE food product using sensational language as defined above.
- Preserve the underlying product, all ingredients, and all factual information.
- Do not add, remove, replace, or invent ingredients.
- Do not invent factual claims such as fresh, local, organic, handmade, premium, award-winning, healthy, authentic, imported, aged, or rare unless the source explicitly states them.
- Use dramatic and emotionally evocative phrasing where natural, including affective evaluation, metaphor, personification, or experiential framing.
- Do not simply turn the text into a sensory description.
- Correct grammar and punctuation when appropriate.
- Preserve the original language.
- Do not explain your changes. Return only the rewritten text in the structured output field.`;
}

async function callOpenAI({ mode, text, file }) {
  if (!process.env.OPENAI_API_KEY) {
    const err = new Error('OPENAI_API_KEY is missing from the server environment.');
    err.status = 500;
    throw err;
  }

  const content = [];
  if (file) {
    const mime = mimeFor(file.originalname, file.mimetype);
    const base64 = file.buffer.toString('base64');
    content.push({ type: 'input_file', filename: file.originalname, file_data: `data:${mime};base64,${base64}` });
  }
  if (text && text.trim()) content.push({ type: 'input_text', text: `USER CONTENT:\n${text.trim()}` });
  if (!content.length) {
    const err = new Error('Please enter text or upload a file.');
    err.status = 400;
    throw err;
  }

  content.push({ type: 'input_text', text: mode === 'menu' ? menuPrompt() : productPrompt() });

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      input: [{ role: 'user', content }],
      text: { format: { type: 'json_schema', name: 'sensational_food_rewrite', strict: true, schema: outputSchema } }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    const err = new Error(data?.error?.message || 'OpenAI API request failed.');
    err.status = response.status;
    throw err;
  }

  let outputText = '';
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    outputText = data.output_text.trim();
  } else {
    const chunks = [];
    for (const item of data.output || []) {
      if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (part?.type === 'output_text' && typeof part.text === 'string') chunks.push(part.text);
        if (part?.type === 'refusal' && typeof part.refusal === 'string') {
          const err = new Error(part.refusal);
          err.status = 422;
          throw err;
        }
      }
    }
    outputText = chunks.join('\n').trim();
  }

  if (!outputText) {
    console.error('OpenAI response without readable output:', JSON.stringify(data, null, 2));
    const err = new Error('The model returned no readable output.');
    err.status = 502;
    throw err;
  }

  try { return JSON.parse(outputText); }
  catch {
    console.error('Unparseable model output:', outputText);
    const err = new Error('The model response could not be parsed.');
    err.status = 502;
    throw err;
  }
}

app.post('/api/rewrite', upload.single('file'), async (req, res, next) => {
  try {
    const mode = req.body.mode;
    const text = req.body.text || '';
    if (!['menu', 'product'].includes(mode)) {
      const err = new Error('Please choose Menu or Food Product.');
      err.status = 400;
      throw err;
    }
    if (mode === 'menu' && req.body.ingredientsConfirmed !== 'true') {
      const err = new Error('Please confirm that the menu includes a list of ingredients.');
      err.status = 400;
      throw err;
    }
    if (mode === 'product' && req.file) {
      const err = new Error('For one food product, please paste the text instead of uploading a file.');
      err.status = 400;
      throw err;
    }
    const result = await callOpenAI({ mode, text, file: req.file });
    res.json(result);
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`Sensational Language Lab running at http://localhost:${PORT}`);
  console.log(`Model: ${MODEL}`);
});
