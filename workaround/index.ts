// WORKAROUND for serializableMessengerEvent stripping fetchMetadata
//
// Because the Telegram adapter stores file_id only in fetchMetadata.fileId
// (which serializableMessengerEvent strips), we intercept the raw webhook
// payload here — before Think sees it — and inject the file_id into the
// message text. This way it survives serialization and reaches the sub-agent.
//
// Replace src/index.ts with this file to apply the workaround.

import { getAgentByName, routeAgentRequest } from "agents";
import { MyAgent } from "../src/agent";

export { MyAgent };

const WEBHOOK_PATH = "/messengers/telegram/webhook";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const agentResponse = await routeAgentRequest(request, env);
		if (agentResponse) return agentResponse;

		const url = new URL(request.url);
		const agent = await getAgentByName(env.MyAgent, "default");

		if (url.pathname === WEBHOOK_PATH) {
			// Inject photo file_ids into the message text before Think serializes
			// the event. serializableMessengerEvent drops fetchMetadata, so the
			// file_id would otherwise be lost when the event reaches the sub-agent.
			const body = await request.json().catch(() => null) as Record<string, unknown> | null;
			if (body) {
				const msg = (body.message ?? body.edited_message) as Record<string, unknown> | undefined;
				const photos = msg?.photo as Array<{ file_id: string; file_size?: number }> | undefined;
				if (photos?.length) {
					// Telegram sends multiple sizes; the last is the largest.
					const largest = photos[photos.length - 1];
					const existing = (msg?.text as string | undefined) ?? (msg?.caption as string | undefined) ?? "";
					const injected = `${existing}\n\n[photo file_id: ${largest.file_id}]`.trim();
					if (msg) {
						if (msg.text) (msg as Record<string, unknown>).text = injected;
						else (msg as Record<string, unknown>).text = injected;
					}
				}
				const modified = new Request(request.url, {
					method: request.method,
					headers: request.headers,
					body: JSON.stringify(body),
				});
				return agent.fetch(modified);
			}
			return agent.fetch(request);
		}

		if (url.pathname === "/setup") {
			const webhookUrl = `https://${url.host}${WEBHOOK_PATH}`;
			const res = await fetch(
				`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						url: webhookUrl,
						secret_token: env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
						allowed_updates: ["message"],
						drop_pending_updates: true,
					}),
				},
			);
			return Response.json({ ok: res.ok, webhookUrl, result: await res.json() });
		}

		return Response.json({ webhook: WEBHOOK_PATH, setup: "GET /setup" });
	},
} satisfies ExportedHandler<Env>;
