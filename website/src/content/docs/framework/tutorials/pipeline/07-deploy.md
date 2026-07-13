---
title: "Step 6: Test & Deploy"
description: "Test the full pipeline and deploy to production."
---

# Step 6: Test & Deploy

## Full Pipeline Test

Start the dev server:
```bash
kernova dev
```

Open http://localhost:3000/chat and try the full pipeline:

**Input:** "Write a blog post about how AI is changing software development in 2026"

**Expected behavior:**
1. You see "🔍 Starting research..." 
2. Wait 5-10 seconds (Researcher is searching the web)
3. You see "🧠 Analyzing findings..."
4. Wait 3-5 seconds (Analyzer is processing)
5. You see "✍️ Writing content..."
6. Wait 5-10 seconds (Writer is composing)
7. Final article appears — well-structured, sourced, engaging

**Total time:** 15-30 seconds for a complete researched article.

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| No web results | DuckDuckGo rate limited | Add `TAVILY_API_KEY` to `.env.local` |
| Very slow | Three sequential API calls | Normal — each takes 5-10s |
| Router shows help for everything | Keywords don't match | Use trigger words: "write", "research", "analyze" |
| Empty article | Researcher found nothing | Try a broader topic |

## Deploy

```bash
git init && git add -A && git commit -m "Content pipeline - multi-agent"
git remote add origin https://github.com/YOU/content-pipeline.git
git push -u origin main

kernova login --key kn_live_xxx
kernova deploy
```

## What You Built

✅ **4 specialized agents** collaborating  
✅ **Router pattern** for intelligent request routing  
✅ **Sequential pipeline** (research → analyze → write)  
✅ **Delegation** between agents  
✅ **Progress indicators** for long-running operations  
✅ **Web search integration** for real-time data  
✅ **Deployed to production**  

## Key Takeaways

1. **Split by skill** — Each agent does one thing well
2. **Code routing is fast** — Use handlers for deterministic decisions
3. **Temperature matters** — 0.3 for facts, 0.8 for creative
4. **Delegation is powerful** — `ctx.delegate()` connects any agents
5. **Progress updates** — `ctx.emit()` keeps users informed

## Ideas to Extend

- Add a **reviewer agent** that fact-checks the writer's output
- Add a **scheduler** that auto-generates daily content
- Add **different output formats** (social thread, newsletter, video script)
- Add a **feedback loop** — user rates the article, agents improve
- Connect to **CMS** — auto-publish to your blog via a tool

---

Next tutorial: [Autonomous DevOps Agent →](/framework/tutorials/devops/01-intro) (advanced)
