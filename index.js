const express = require("express");
const axios = require("axios");
const sharp = require("sharp");
const app = express();
app.use(express.json());

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const processed = new Set();

// 冷蔵不要の品名キーワード（新ワークフロー）
const NON_REFRIGERATED_KEYWORDS = ["ﾘﾍﾞ", "ﾙｾ", "ｴｾﾞ", "防黄", "防通"];

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
    const inlineMatches = msgText.match(/\S+/g) || [];

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
      const fallbackMatches = fallbackText.match(/\S+/g) || [];
      slackItems = [...new Set(fallbackMatches)];
    }

    if (slackItems.length === 0) {
      await postMessage(event.channel, event.ts, "⚠️ 品名リストが見つかりませんでした。ワークフローで品名を選んでから写真を投稿してください。");
      return;
    }

    // 2. 冷蔵不要かどうか判定
    const isNonRefrigerated = slackItems.some(item =>
      NON_REFRIGERATED_KEYWORDS.some(kw => item.includes(kw))
    );

    // 3. 画像をダウンロード＆圧縮（4MB以下になるまで）
    const fileUrl = files[0].url_private;
    const imgRes = await axios.get(fileUrl, {
      headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
      responseType: "arraybuffer"
    });

    let quality = 80;
    let processedImg;
    do {
      processedImg = await sharp(Buffer.from(imgRes.data))
        .resize({ width: 1500, withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
      quality -= 10;
    } while (processedImg.length > 4 * 1024 * 1024 && quality > 10);

    const base64Image = processedImg.toString("base64");
    const mimeType = "image/jpeg";

    // 4. 冷蔵チェックのプロンプトを切り替え
    const refrigerationRule = isNonRefrigerated
      ? `2. 伝票に「冷蔵」という文字やマークが含まれているか確認してください。\n\n【冷蔵に関する返答ルール】\n- 冷蔵マークが一つでも確認できる場合：「❄️ 冷蔵の伝票があります。目視で確認してください」と返してください。\n- 冷蔵マークがない場合：何も言及しなくてOKです。`
      : `2. 伝票に「冷蔵」という文字やマークが含まれているか確認してください。伝票本体・伝票の横のシール・伝票の右上など、どこかに「冷蔵」という文字があればOKです。\n\n【冷蔵に関する返答ルール】\n- 画像のどこかに「冷蔵」という文字が確認できれば冷蔵OKとしてください。\n- 画像のどこにも「冷蔵」という文字が一切確認できない場合のみ：「❄️ 冷蔵ではない伝票があります。目視で確認してください」と返してください。`;

    // 5. Claude APIで照合
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
              text: `この画像はヤマト運輸の伝票です。\n\n伝票の左端に縦長の細い欄があり、そこに「品名」という項目が縦に並んでいます。その「品名」という文字の隣（右側）に小さく記載されている文字列（例：M2.5-3ヶ月）を読み取ってください。\n\n【絶対に無視すること】\n- 〇〇様という宛名\n- 住所・電話番号\n- 伝票番号（数字のバーコード上の番号）\n\n【品名の特徴】\n- アルファベット・数字・記号・カタカナの組み合わせ\n- 「様」という文字は絶対に含まれない\n- 例：M2.5-1ヶ月、M2.5-3ヶ月、ﾘﾍﾞ3㎎_1ｹ月_30\n\n【正しい品名リスト】\n${slackItems.join(", ")}\n\n以下の2点を確認してください：\n1. 読み取ったすべての品名が品名リストと一致しているか\n${refrigerationRule}\n\n【返答ルール】\n- 品名がすべて一致し、冷蔵チェックも問題なければ：「確認済み✅」とだけ返してください。\n- 品名が一つでも不一致の場合：「⚠️ 誤りがあるので目視で確認してください」と不一致の品名を返してください。`
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
