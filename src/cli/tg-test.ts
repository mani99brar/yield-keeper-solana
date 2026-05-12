import { sendTelegramMessage } from "../telegram.js";

async function main() {
  const [chatId, ...rest] = process.argv.slice(2);
  if (!chatId) {
    console.error("Usage: yarn tsx src/cli/tg-test.ts <chatId> [text...]");
    process.exit(1);
  }
  const text =
    rest.length > 0
      ? rest.join(" ")
      : "<b>Keeper test</b>\n\nNotification pipeline is live. Real deposit messages will follow this format.";
  await sendTelegramMessage(chatId, text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
