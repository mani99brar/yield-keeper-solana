import { config, explorerTxUrl } from "./config.js";
import { log } from "./logger.js";

/**
 * Send a Telegram message to a chat. No-ops (with a warning) if TELEGRAM_BOT_TOKEN is unset.
 * Never throws — Telegram failures must not break the savings flow.
 */
export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
): Promise<void> {
  if (!config.telegramBotToken) {
    log.warn({ chatId }, "TELEGRAM_BOT_TOKEN not configured — skipping notification");
    return;
  }

  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const body = (await res.json()) as { ok: boolean; description?: string };
    if (!body.ok) {
      log.error({ chatId, status: res.status, description: body.description }, "Telegram API error");
      return;
    }
    log.info({ chatId }, "Telegram notification sent");
  } catch (err: any) {
    log.error({ chatId, err: err?.message }, "Failed to send Telegram message");
  }
}

const short = (addr: string) => `${addr.slice(0, 4)}…${addr.slice(-4)}`;
const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
const fmtJlUsdc = (raw: string) => (Number(raw) / 1_000_000).toFixed(6);

export function buildSuccessMessage(args: {
  amountUsd: number;
  jlUsdcReceived: string;
  recipientAddress: string;
  transferSignature: string;
}): string {
  return [
    `✅ <b>Savings deposit complete</b>`,
    ``,
    `💵 Amount: ${fmtUsd(args.amountUsd)}`,
    `🌱 Received: ${fmtJlUsdc(args.jlUsdcReceived)} jlUSDC`,
    `🔐 Vault: <code>${short(args.recipientAddress)}</code>`,
    ``,
    `🔗 <a href="${explorerTxUrl(args.transferSignature)}">View transaction</a>`,
  ].join("\n");
}

export function buildPartialMessage(args: {
  amountUsd: number;
  depositSignature: string;
}): string {
  return [
    `⚠️ <b>Savings deposit partially complete</b>`,
    ``,
    `Your ${fmtUsd(args.amountUsd)} deposit was confirmed but transferring it to your vault failed.`,
    `🛠 Our team is investigating — your funds are safe.`,
    ``,
    `🔗 <a href="${explorerTxUrl(args.depositSignature)}">View deposit transaction</a>`,
  ].join("\n");
}
