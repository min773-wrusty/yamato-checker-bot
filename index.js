{\rtf1\ansi\ansicpg932\cocoartf2868
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\paperw11900\paperh16840\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 const express = require("express");\
const axios = require("axios");\
const app = express();\
app.use(express.json());\
\
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;\
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;\
\
// \uc0\u37325 \u35079 \u12452 \u12505 \u12531 \u12488 \u38450 \u27490 \
const processed = new Set();\
\
app.post("/slack/events", async (req, res) => \{\
  const \{ type, challenge, event \} = req.body;\
\
  if (type === "url_verification") return res.json(\{ challenge \});\
  res.sendStatus(200);\
\
  if (!event || event.type !== "message" || event.bot_id) return;\
  if (processed.has(event.ts)) return;\
  processed.add(event.ts);\
\
  // \uc0\u30011 \u20687 \u12501 \u12449 \u12452 \u12523 \u12364 \u21547 \u12414 \u12428 \u12390 \u12356 \u12427 \u12363 \u30906 \u35469 \
  const files = event.files?.filter(f => f.mimetype?.startsWith("image/"));\
  if (!files || files.length === 0) return;\
\
  try \{\
    // 1. \uc0\u21516 \u12376 \u12513 \u12483 \u12475 \u12540 \u12472 \u12398 \u12486 \u12461 \u12473 \u12488 \u12363 \u12425 \u21697 \u21517 \u12434 \u21462 \u24471 \
    let slackItems = [];\
    const msgText = event.text || "";\
    const inlineMatches = msgText.match(/[A-Z][\\w.]*[-\uc0\u65293 ]\\d+\u12534 \u26376 /g) || [];\
\
    if (inlineMatches.length > 0) \{\
      slackItems = [...new Set(inlineMatches)];\
    \} else \{\
      // \uc0\u12481 \u12515 \u12531 \u12493 \u12523 \u23653 \u27508 \u12363 \u12425 \u30452 \u36817 \u12398 \u12486 \u12461 \u12473 \u12488 \u12434 \u25506 \u12377 \
      const histRes = await axios.get("https://slack.com/api/conversations.history", \{\
        headers: \{ Authorization: `Bearer $\{SLACK_TOKEN\}` \},\
        params: \{ channel: event.channel, limit: 10 \}\
      \});\
      const messages = histRes.data.messages || [];\
      const textMsg = messages.find(m => !m.files && m.text && m.ts !== event.ts);\
      const fallbackText = textMsg?.text || "";\
      const fallbackMatches = fallbackText.match(/[A-Z][\\w.]*[-\uc0\u65293 ]\\d+\u12534 \u26376 /g) || [];\
      slackItems = [...new Set(fallbackMatches)];\
    \}\
\
    if (slackItems.length === 0) \{\
      await postMessage(event.channel, event.ts, "\uc0\u9888 \u65039  \u21697 \u21517 \u12522 \u12473 \u12488 \u12364 \u35211 \u12388 \u12363 \u12426 \u12414 \u12379 \u12435 \u12391 \u12375 \u12383 \u12290 \u12527 \u12540 \u12463 \u12501 \u12525 \u12540 \u12391 \u21697 \u21517 \u12434 \u36984 \u12435 \u12391 \u12363 \u12425 \u20889 \u30495 \u12434 \u25237 \u31295 \u12375 \u12390 \u12367 \u12384 \u12373 \u12356 \u12290 ");\
      return;\
    \}\
\
    // 2. \uc0\u30011 \u20687 \u12434 \u12480 \u12454 \u12531 \u12525 \u12540 \u12489 \
    const fileUrl = files[0].url_private;\
    const imgRes = await axios.get(fileUrl, \{\
      headers: \{ Authorization: `Bearer $\{SLACK_TOKEN\}` \},\
      responseType: "arraybuffer"\
    \});\
    const base64Image = Buffer.from(imgRes.data).toString("base64");\
    const mimeType = files[0].mimetype;\
\
    // 3. Claude API\uc0\u12391 \u20253 \u31080 \u30011 \u20687 \u12363 \u12425 \u21697 \u21517 \u35501 \u12415 \u21462 \u12426 \
    const claudeRes = await axios.post(\
      "https://api.anthropic.com/v1/messages",\
      \{\
        model: "claude-sonnet-4-20250514",\
        max_tokens: 1000,\
        system: "\uc0\u12516 \u12510 \u12488 \u36939 \u36664 \u12398 \u20253 \u31080 \u30011 \u20687 \u12363 \u12425 \u21697 \u21517 \u12398 \u12415 \u12434 \u35501 \u12415 \u21462 \u12426 \u12289 JSON\u12398 \u12415 \u12391 \u36820 \u12375 \u12390 \u12367 \u12384 \u12373 \u12356 \u12290 \u24418 \u24335 : \{\\"items\\": [\{\\"label\\": \\"\u20253 \u31080 \u30058 \u21495 \\", \\"item\\": \\"\u21697 \u21517 \\"\},...]\}",\
        messages: [\{\
          role: "user",\
          content: [\
            \{ type: "image", source: \{ type: "base64", media_type: mimeType, data: base64Image \} \},\
            \{ type: "text", text: "\uc0\u12371 \u12398 \u30011 \u20687 \u12395 \u20889 \u12387 \u12390 \u12356 \u12427 \u12377 \u12409 \u12390 \u12398 \u12516 \u12510 \u12488 \u20253 \u31080 \u12398 \u21697 \u21517 \u12392 \u20253 \u31080 \u30058 \u21495 \u12434 \u35501 \u12415 \u21462 \u12387 \u12390 \u12367 \u12384 \u12373 \u12356 \u12290 " \}\
          ]\
        \}]\
      \},\
      \{\
        headers: \{\
          "x-api-key": ANTHROPIC_KEY,\
          "anthropic-version": "2023-06-01",\
          "Content-Type": "application/json"\
        \}\
      \}\
    );\
\
    const rawText = claudeRes.data.content.map(b => b.text || "").join("");\
    let labelItems = [];\
    try \{\
      const parsed = JSON.parse(rawText.replace(/```json|```/g, "").trim());\
      labelItems = parsed.items || [];\
    \} catch \{ labelItems = []; \}\
\
    // 4. \uc0\u29031 \u21512 \
    const mismatches = labelItems.filter(li => !slackItems.includes(li.item));\
    const matched = mismatches.length === 0 && labelItems.length > 0;\
\
    // 5. \uc0\u32080 \u26524 \u12434 Slack\u12398 \u12473 \u12524 \u12483 \u12489 \u12395 \u36820 \u20449 \
    let replyText;\
    if (matched) \{\
      replyText = "\uc0\u9989  \u21697 \u21517 \u12364 \u12377 \u12409 \u12390 \u19968 \u33268 \u12375 \u12390 \u12356 \u12414 \u12377 \u65281 \u30906 \u35469 \u28168 \u12415 \u9989 ";\
    \} else if (mismatches.length > 0) \{\
      const list = mismatches.map(m => `\uc0\u12539 $\{m.label\}\u65306 $\{m.item\}`).join("\\n");\
      replyText = `\uc0\u9888 \u65039  \u20253 \u31080 \u12398 \u21697 \u21517 \u12395 \u35492 \u12426 \u12364 \u12354 \u12427 \u21487 \u33021 \u24615 \u12364 \u12354 \u12426 \u12414 \u12377 \u12290 \u30446 \u35222 \u12391 \u30906 \u35469 \u12375 \u12390 \u12367 \u12384 \u12373 \u12356 \u12290 \\n\\n\u12304 \u19981 \u19968 \u33268 \u12398 \u20253 \u31080 \u12305 \\n$\{list\}\\n\\n\u12304 \u27491 \u12375 \u12356 \u21697 \u21517 \u12305 \\n$\{slackItems.join(", ")\}`;\
    \} else \{\
      replyText = "\uc0\u9888 \u65039  \u21697 \u21517 \u12434 \u35501 \u12415 \u21462 \u12428 \u12414 \u12379 \u12435 \u12391 \u12375 \u12383 \u12290 \u30011 \u20687 \u12434 \u12372 \u30906 \u35469 \u12367 \u12384 \u12373 \u12356 \u12290 ";\
    \}\
\
    await postMessage(event.channel, event.ts, replyText);\
\
  \} catch (err) \{\
    console.error("Error:", err.message);\
    await postMessage(event.channel, event.ts, `\uc0\u10060  \u12456 \u12521 \u12540 \u12364 \u30330 \u29983 \u12375 \u12414 \u12375 \u12383 \u65306 $\{err.message\}`);\
  \}\
\});\
\
async function postMessage(channel, thread_ts, text) \{\
  await axios.post(\
    "https://slack.com/api/chat.postMessage",\
    \{ channel, text, thread_ts \},\
    \{ headers: \{ Authorization: `Bearer $\{SLACK_TOKEN\}` \} \}\
  ).catch(e => console.error("postMessage error:", e.message));\
\}\
\
app.get("/", (_, res) => res.send("\uc0\u20253 \u31080 \u12481 \u12455 \u12483 \u12459 \u12540  Bot \u31292 \u20685 \u20013 "));\
\
const PORT = process.env.PORT || 3000;\
app.listen(PORT, () => console.log(`Server running on port $\{PORT\}`));}