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
  return `You rewrite restaurant-menu ingredient descriptions using the exact style of a research manipulation of sensational language.

CORE STYLE
Sensational language uses drama, intensity, emotional impact, and enjoyment-oriented wording while preserving the same underlying ingredients. The result should sound like a polished restaurant-menu description: compact, fluent, appetizing, and natural. It should NOT sound like an essay, ad campaign, poem, or ingredient-by-ingredient dictionary.

REFERENCE EXAMPLES
Neutral: "Spaghetti, tomato sauce, garlic, basil, parmesan."
Sensational: "Golden spaghetti twirls through a rich tomato embrace, garlic sparks the flavor, basil adds a fresh lift, and parmesan crowns it with irresistible delight."

Neutral: "Lettuce, cherry tomatoes, cucumber, olives, feta cheese."
Sensational: "Crisp lettuce bursts with freshness, juicy cherry tomatoes sparkle with flavor, cool cucumber and briny olives add zest, and creamy feta crowns the salad with irresistible delight."

STYLE RULES
- Write one cohesive, flowing restaurant-menu description for each food item.
- Prefer one sentence per item; use two short sentences only when needed for a long ingredient list.
- Keep the wording reasonably concise and similar in length and cadence to the reference examples.
- Use emotionally charged verbs and adjectives, pleasurable framing, and tasteful dramatic language.
- Do NOT write constructions such as "butter — a velvet richness; chicken — a succulent centerpiece".
- NEVER use an em dash (—) or en dash (–) to attach commentary to individual ingredients.
- Do NOT turn each ingredient into a separate mini-description.
- Do NOT add a lead-in such as "a scintillating lineup" or "these ingredients create".
- Do NOT make the prose excessively ornate, abstract, theatrical, or literary.
- Do NOT explain the rewrite.

MENU-SEPARATION RULES
- The user separately provides FOOD NAME(S), one per line, in the same order as the menu items.
- Use those food names exactly as provided.
- Detect every distinct food/menu item in the input and pair each item with the corresponding food name by order.
- Rewrite EACH food item separately.
- Never combine ingredients from different dishes into one description.
- Preserve the original order of menu items.
- Output each food name on its own line, followed by only that food's rewritten sensational description on the next line.
- Put a blank line between different foods.
- If prices, quantities, dietary markers, or labels are present, keep them unchanged with the correct food item.

CONTENT-PRESERVATION RULES
- Return the FULL menu text organized by the provided food names.
- Rewrite only ingredient lists and ingredient-description portions.
- Preserve every stated ingredient and the underlying dish.
- Do not add, remove, substitute, or invent ingredients.
- Do not invent factual claims such as local, organic, handmade, premium, award-winning, healthy, authentic, imported, aged, or rare unless explicitly stated.
- Sensational adjectives or experiential phrasing are allowed when they do not introduce a new factual claim.
- Correct obvious grammar, spelling, capitalization, and punctuation where appropriate.
- Preserve the original language of the menu.

Return only the transformed menu in the structured output field.`;
}

function productPrompt() {
  return `You rewrite text for ONE food product using the exact style of a research manipulation of sensational language.

CORE STYLE
Sensational language uses drama, intensity, emotional impact, and enjoyment-oriented wording while preserving the same underlying food and ingredients. The result should sound like a polished restaurant-menu description: compact, fluent, appetizing, and natural.

REFERENCE EXAMPLES
Neutral: "Spaghetti, tomato sauce, garlic, basil, parmesan."
Sensational: "Golden spaghetti twirls through a rich tomato embrace, garlic sparks the flavor, basil adds a fresh lift, and parmesan crowns it with irresistible delight."

Neutral: "Lettuce, cherry tomatoes, cucumber, olives, feta cheese."
Sensational: "Crisp lettuce bursts with freshness, juicy cherry tomatoes sparkle with flavor, cool cucumber and briny olives add zest, and creamy feta crowns the salad with irresistible delight."

STYLE RULES
- The user separately provides the FOOD NAME. Use that food name exactly as provided.
- Produce one cohesive, flowing description, normally one sentence.
- Keep it reasonably concise and similar in length and cadence to the reference examples.
- Use emotionally charged verbs and adjectives, pleasurable framing, and tasteful dramatic language.
- Do NOT write constructions such as "butter — a velvet richness; chicken — a succulent centerpiece".
- NEVER use an em dash (—) or en dash (–) to attach commentary to ingredients.
- Do NOT describe each ingredient separately as a list of mini-definitions.
- Do NOT add a lead-in such as "a scintillating lineup" or "these ingredients create".
- Do NOT make the prose excessively ornate, abstract, theatrical, or literary.
- Do NOT explain the rewrite.

CONTENT-PRESERVATION RULES
- Preserve the underlying product, all stated ingredients, and all factual information.
- Do not add, remove, substitute, or invent ingredients.
- Do not invent factual claims such as local, organic, handmade, premium, award-winning, healthy, authentic, imported, aged, or rare unless explicitly stated.
- Sensational adjectives or experiential phrasing are allowed when they do not introduce a new factual claim.
- Correct obvious grammar, spelling, capitalization, and punctuation where appropriate.
- Preserve the original language.
- Output the exact food name on the first line and the sensationalized description on the next line.

Return only the rewritten food name and description in the structured output field.`;
}

async function callOpenAI({ mode, text, file, foodNames, foodName }) {
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
  if (mode === 'menu' && foodNames && foodNames.trim()) {
    content.push({ type: 'input_text', text: `FOOD NAME(S), ONE PER LINE IN MENU ORDER:\n${foodNames.trim()}` });
  }
  if (mode === 'product' && foodName && foodName.trim()) {
    content.push({ type: 'input_text', text: `FOOD NAME:\n${foodName.trim()}` });
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
    const foodNames = req.body.foodNames || '';
    const foodName = req.body.foodName || '';

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
    if (mode === 'menu' && !foodNames.trim()) {
      const err = new Error('Please enter the food name. For multiple foods, enter one name per line.');
      err.status = 400;
      throw err;
    }
    if (mode === 'product' && !foodName.trim()) {
      const err = new Error('Please enter the food name.');
      err.status = 400;
      throw err;
    }
    if (mode === 'product' && req.file) {
      const err = new Error('For one food product, please paste the text instead of uploading a file.');
      err.status = 400;
      throw err;
    }

    const result = await callOpenAI({ mode, text, file: req.file, foodNames, foodName });
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
