import { getAgentByName, routeAgentRequest } from "agents";
import { MyAgent } from "./agent";

export { MyAgent };

const WEBHOOK_PATH = "/messengers/telegram/webhook";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const agentResponse = await routeAgentRequest(request, env);
		if (agentResponse) return agentResponse;

		const url = new URL(request.url);
		const agent = await getAgentByName(env.MyAgent, "default");

		if (url.pathname === WEBHOOK_PATH) {
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
