const express = require("express");
const axios = require("axios");
const sharp = require("sharp");
const app = express();
app.use(express.json());

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const processed = new Set();

app.post("/slack/events", async (req, res) => {
  const { type, challenge, event } = req.body;

  if (type === "url_verification") return res.json({ challenge });
  res.sendStatus(200);

  if (!event || event.type !== "message" || event.bot_id) return;
  if (processed.has(event.ts)) return;
  processed.add(event.ts);

  const files = event.files?.filter(f => f.mimetype?.startsWith("image/"));
  if (!files || files.length === 0) return;

  try {
    // 1. 品名を取得
    let slackItems = [];
    const msgText = event.text || "";
    const inlineMatches = msgText.match(/[A-Za-z][\w.]*[-－]\d+ヶ月/g) || [];

    if (inlineMatches.length > 0) {
      slackItems = [...new Set(inlineMatches)];
    } else {
      const histRes = await axios.get("https://slack.com/api/conversations.history", {
        headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
        params: { channel: event.channel, limit: 10 }
      });
      const messages = histRes.data.messages || [];
      const textMsg = messages.find(m => !m.files && m.text && m.ts !== event.ts);
      const fallbackText = textMsg?.text || "";
      const fallbackMatches = fallbackText.match(/[A-Za-z][\w.]*[-－]\d+ヶ月/g) || [];
      slackItems = [...new Set(fallbackMatches)];
    }

    if (slackItems.length === 0) {
      await postMessage(event.channel, event.ts, "⚠️ 品名リストが見つかりませんでした。ワークフローで品名を選んでから写真を投稿してください。");
      return;
    }

    // 2. 画像をダウンロード＆拡大処理
    const fileUrl = files[0].url_private;
    const imgRes = await axios.get(fileUrl, {
      headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
      responseType: "arraybuffer"
    });

    // 画像を拡大してシャープ処理（文字を読みやすくする）
    const processedImg = await sharp(Buffer.from(imgRes.data))
      .resize({ width: 3200, withoutEnlargement: false }) // 強制的に拡大
      .sharpen({ sigma: 1.5 }) // シャープネスを上げて文字をくっきり
      .jpeg({ quality: 90 })
      .toBuffer();

    const base64Image = processedImg.toString("base64");
    const mimeType = "image/jpeg";

    // 3. Claude APIで照合
    const claudeRes = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mimeType, data: base64Image }
            },
            {
              type: "text",
              text: `この画像はヤマト運輸の伝票です。各伝票に「品名」という文字が印刷されており、その右横に手書きまたは印字された文字があります。その「品名」の右に書かれた文字（例：M2.5-1ヶ月）のみを読み取り、以下のリストと照合してください。伝票番号・宛名・住所・電話番号は無視してください。\n\n【正しい品名リスト】\n${slackItems.join(", ")}\n\n以下の2点を確認してください：\n1. 品名が一致しているか\n2. 伝票または伝票の右上部に黒い「冷蔵」または「冷蔵クール」と書かれたマークがあるか\n\nすべての品名が一致し、かつすべての伝票に冷蔵の文字が確認できれば「確認済み✅」とだけ返してください。\n品名が不一致の場合は「⚠️ 誤りがあるので目視で確認してください」と不一致の品名を返してください。\n冷蔵マークが明確に確認できない伝票がある場合のみ「❄️ 冷蔵ではない伝票があります。目視で確認してください」と返してください。`
            }
          ]
        }]
      },
      {
        headers: {
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        }
      }
    );

    const replyText = claudeRes.data.content.map(b => b.text || "").join("");
    await postMessage(event.channel, event.ts, replyText);

  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
    await postMessage(event.channel, event.ts, `❌ エラーが発生しました：${err.message}`);
  }
});

async function postMessage(channel, thread_ts, text) {
  await axios.post(
    "https://slack.com/api/chat.postMessage",
    { channel, text, thread_ts },
    { headers: { Authorization: `Bearer ${SLACK_TOKEN}` } }
  ).catch(e => console.error("postMessage error:", e.message));
}

app.get("/", (_, res) => res.send("伝票チェッカー Bot 稼働中"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
