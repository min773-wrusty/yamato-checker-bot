const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TARGET_CHANNEL = process.env.SLACK_CHANNEL_NAME; // 例: "出荷管理"

// Slackの重複イベント防止
const processed = new Set();

app.post("/slack/events", async (req, res) => {
  const { type, challenge, event } = req.body;

  // URL確認用
  if (type === "url_verification") return res.json({ challenge });

  res.sendStatus(200);

  // メッセージイベントのみ処理
  if (!event || event.type !== "message" || event.bot_id) return;
  if (processed.has(event.ts)) return;
  processed.add(event.ts);

  // 画像ファイルが含まれているか確認
  const files = event.files?.filter(f => f.mimetype?.startsWith("image/"));
  if (!files || files.length === 0) return;

  try {
    // 1. 品名リストを同チャンネルの直近テキストメッセージから取得
    const histRes = await axios.get("https://slack.com/api/conversations.history", {
      headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
      params: { channel: event.channel, limit: 20 }
    });
    const messages = histRes.data.messages || [];
    // 画像投稿より前のテキストメッセージを探す
    const textMsg = messages.find(m => !m.files && m.text && m.ts !== event.ts);
    const slackText = textMsg?.text || "";

    // 品名リストを抽出（例: M2.5-1ヶ月, M2.5-3ヶ月）
    const itemMatches = slackText.match(/M[\d.]+[-－]\d+ヶ月/g) || [];
    const slackItems = [...new Set(itemMatches)];

    // 2. 画像をダウンロード
    const fileUrl = files[0].url_private;
    const imgRes = await axios.get(fileUrl, {
      headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
      responseType: "arraybuffer"
    });
    const base64Image = Buffer.from(imgRes.data).toString("base64");
    const mimeType = files[0].mimetype;

    // 3. Claude APIで伝票画像から品名読み取り
    const claudeRes = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: "ヤマト運輸の伝票画像から品名のみを読み取り、JSONのみで返してください。形式: {\"items\": [{\"label\": \"伝票番号\", \"item\": \"品名\"},...]}",
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mimeType, data: base64Image } },
            { type: "text", text: "この画像に写っているすべてのヤマト伝票の品名と伝票番号を読み取ってください。" }
          ]
        }]
      },
      {
        headers: {
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        }
      }
    );

    const rawText = claudeRes.data.content.map(b => b.text || "").join("");
    let labelItems = [];
    try {
      const parsed = JSON.parse(rawText.replace(/```json|```/g, "").trim());
      labelItems = parsed.items || [];
    } catch { labelItems = []; }

    // 4. 照合
    const mismatches = labelItems.filter(li => !slackItems.includes(li.item));
    const matched = mismatches.length === 0 && labelItems.length > 0;

    // 5. 結果をSlackに投稿
    let replyText;
    if (matched) {
      replyText = "✅ 品名が一致しています！確認済み✅";
    } else if (mismatches.length > 0) {
      const list = mismatches.map(m => `・${m.label}：${m.item}`).join("\n");
      replyText = `⚠️ 伝票の品名に誤りがある可能性があります。目視で確認してください。\n\n【不一致の伝票】\n${list}`;
    } else {
      replyText = "⚠️ 品名を読み取れませんでした。画像をご確認ください。";
    }

    await axios.post(
      "https://slack.com/api/chat.postMessage",
      { channel: event.channel, text: replyText, thread_ts: event.ts },
      { headers: { Authorization: `Bearer ${SLACK_TOKEN}` } }
    );

  } catch (err) {
    console.error("Error:", err.message);
    await axios.post(
      "https://slack.com/api/chat.postMessage",
      { channel: event.channel, text: `❌ エラーが発生しました：${err.message}`, thread_ts: event.ts },
      { headers: { Authorization: `Bearer ${SLACK_TOKEN}` } }
    ).catch(() => {});
  }
});

app.get("/", (_, res) => res.send("伝票チェッカー Bot 稼働中"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
