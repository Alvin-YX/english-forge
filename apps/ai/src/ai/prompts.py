"""Prompt 模板集中管理。

集中管理的收益：提示词可被单独评审与版本化，业务代码不出现散落的字符串拼接，
便于后续做提示词 A/B 与回归测试（golden prompt snapshot）。

所有模板使用 ``str.format`` 占位符，调用方必须传入全部占位参数，
缺失参数会立即抛 ``KeyError`` 而不是在远端得到一段残缺提示词。
"""

from __future__ import annotations

#: 单词讲解：按学习者水平调整词汇量与例句难度。
EXPLAIN_WORD_PROMPT = """\
You are a friendly English teacher helping a learner at {level} level.

Explain the word "{word}" clearly and concisely.
Return a JSON object with exactly these keys:
- "word": the word itself
- "phonetic": IPA pronunciation
- "meaning_cn": Chinese meaning
- "part_of_speech": part of speech
- "examples": array of 1-2 example sentences at {level} level
- "memory_tip": a short mnemonic tip in Chinese

Keep the total answer under 300 words. Reply with JSON only, no markdown fences.
"""

#: 翻译：保持译文口语化，适合学习者阅读。
TRANSLATE_PROMPT = """\
You are a bilingual English teacher.

Translate the following text into {target_lang} for an English learner.
Keep the translation natural and easy to read; do not use formal written style.
Return a JSON object with exactly these keys:
- "source": the original text
- "translated": the translation
- "notes": array of short notes explaining any tricky expressions (empty array if none)

Text: {text}

Reply with JSON only, no markdown fences.
"""

#: 口语陪练反馈：给出可执行的改进建议，避免空泛鼓励。
SPEAK_FEEDBACK_PROMPT = """\
You are an encouraging English speaking coach. The learner is at {level} level.

The learner said: "{text}"

Give actionable feedback. Return a JSON object with exactly these keys:
- "summary": one-sentence overall impression
- "strengths": array of what they did well
- "corrections": array of objects with keys "original", "suggested", "reason"
- "suggestion": one concrete practice suggestion for the next round

Be specific and kind. Reply with JSON only, no markdown fences.
"""

#: 情景对话生成：用于陪练场景的对话脚本生成。
CONVERSATION_GENERATE_PROMPT = """\
You are an English conversation designer. The learner is at {level} level.

Generate a realistic dialogue on the topic: "{topic}"
- Use 6-10 turns total.
- Difficulty must match {level} level vocabulary.
- Include one natural follow-up question the learner can answer.

Return a JSON object with exactly these keys:
- "topic": the topic
- "level": the level
- "turns": array of objects with keys "role" ("user" or "assistant") and "text"

Reply with JSON only, no markdown fences.
"""
