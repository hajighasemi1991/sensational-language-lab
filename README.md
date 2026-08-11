# Sensational Language Lab

A simple website for two food-language tasks:

1. **Menu:** upload a PDF/Word menu or paste its text. The app rewrites only ingredient lists/descriptions using sensational language and preserves the rest of the menu.
2. **One food product:** paste product text and receive a sensational-language version.

## Local setup

```bash
npm install
cp .env.example .env
```

Add your OpenAI API key to `.env` and run:

```bash
npm start
```

Open `http://localhost:3000`.

## GitHub

Do not commit `.env`; it is already excluded by `.gitignore`.

```bash
git init
git add .
git commit -m "Initial Sensational Language Lab"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

## Railway

1. Create a new Railway project from your GitHub repository.
2. Add these environment variables in Railway:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL=gpt-5-nano`
3. Deploy. Railway will use `npm start`.
