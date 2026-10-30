# 📊 App Ratings Analyzer — TLDR

## 🧩 What it is
One private dashboard that pulls an app's **reviews, ratings & downloads** from
the App Store — and lets **AI summarize the monthly pain points vs. praise**.

> **The bet:** App Store feedback is scattered and noisy. Collect it, let AI
> summarize it, see what to fix next.

## ✅ Done
- 🚀 Live dashboard on **Render + Supabase** (free, password-protected)
- 🔁 **Daily GitHub Actions job** — sync, snapshot, AI report, email
- 🧠 **Pluggable AI** (Groq/OpenAI/Gemini) + local fallback
- 🖼️ **Local OCR** for the per-star breakdown Apple has no API for

## 😵 Pain
- Making the LLM return a **strictly-shaped report** reliably — needed schema +
  examples + a fallback.
- Apple has **no per-star API**, and free hosting **sleeps**.

## 🚀 Next
- 📱 Multi-app & multi-user
- 🔔 Trend alerts → Slack
- 🧪 Tests + typed schema

---

> *"Reviews, ratings & downloads in one dashboard — AI tells you monthly what
> users hate and love."*
