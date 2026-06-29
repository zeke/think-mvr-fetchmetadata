import { createWorkersAI } from "workers-ai-provider";
import { Think, type TurnContext } from "@cloudflare/think";
import { defineMessengers, type ThinkMessengers } from "@cloudflare/think/messengers";
import telegramMessenger from "@cloudflare/think/messengers/telegram";

export class MyAgent extends Think<Env> {
	override getModel() {
		return createWorkersAI({ binding: this.env.AI })("@cf/meta/llama-3.1-8b-instruct");
	}

	override getSystemPrompt() {
		return "You are a helpful assistant. Reply very briefly.";
	}

	// -----------------------------------------------------------------------
	// BUG DEMONSTRATION
	//
	// This beforeTurn hook runs in TWO different contexts depending on the
	// conversation mode:
	//
	// Mode A — conversation: "self" (commented out below):
	//   Runs directly on this DO. getMessengerContext() returns the FULL event
	//   with attachments[*].fetch and attachments[*].raw populated.
	//   Telegram photos have file_id in attachments[*].raw.fetchMetadata.fileId.
	//
	// Mode B — conversation resolver routing to a sub-agent (active below):
	//   The event is serialized via serializableMessengerEvent() before being
	//   passed to the sub-agent DO via chatWithMessengerContext(). This strips
	//   fetchMetadata and raw from every attachment, keeping only:
	//     id, mediaType, name, size, text, url
	//   For Telegram photos, the file_id lives ONLY in fetchMetadata.fileId.
	//   After serialization, id is undefined and fetch is undefined.
	//   There is no way to retrieve the photo from inside the sub-agent.
	//
	// Expected: fetchMetadata (or at minimum the top-level id populated from it)
	//           should survive serialization so sub-agents can work with attachments.
	// -----------------------------------------------------------------------
	override async beforeTurn(ctx: TurnContext) {
		const context = this.getMessengerContext();
		const attachments = context?.message?.attachments ?? [];

		console.log("=== ATTACHMENT DEBUG ===");
		console.log("Number of attachments:", attachments.length);

		for (const [i, a] of attachments.entries()) {
			console.log(`Attachment ${i}:`, JSON.stringify({
				id: a.id,
				mediaType: a.mediaType,
				name: a.name,
				size: a.size,
				url: a.url,
				hasFetch: typeof a.fetch === "function",
				hasRaw: a.raw !== undefined,
				// In Mode A (self), raw contains the original Telegram Attachment
				// object with fetchMetadata.fileId — the Telegram file_id.
				// In Mode B (sub-agent), raw is undefined and id is undefined.
				rawFetchMetadata: (a.raw as { fetchMetadata?: unknown } | null)?.fetchMetadata,
			}));
		}

		if (attachments.length > 0 && !attachments[0].id && !attachments[0].fetch) {
			console.log("BUG CONFIRMED: attachment.id and attachment.fetch are both missing.");
			console.log("This is a sub-agent context — serializableMessengerEvent stripped fetchMetadata.");
		}
	}

	override getMessengers(): ThinkMessengers {
		return defineMessengers({
			telegram: telegramMessenger({
				token: this.env.TELEGRAM_BOT_TOKEN,
				userName: this.env.TELEGRAM_BOT_USERNAME,
				secretToken: this.env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
				respondTo: ["direct-message", "mention"],

				// MODE B (sub-agent resolver) — demonstrates the bug.
				// Switch to `conversation: "self"` (Mode A) to see fetchMetadata present.
				conversation: (event) => ({
					target: "subagent",
					agentClass: MyAgent,
					name: `telegram:${event.thread.id}`,
				}),

				// MODE A (self) — fetchMetadata IS present, no bug.
				// Uncomment to compare:
				// conversation: "self",
			}),
		});
	}
}
