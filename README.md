# think-mvr: serializableMessengerEvent strips fetchMetadata from attachments

Minimum viable reproduction for a bug in `@cloudflare/think` where `serializableMessengerEvent` strips `fetchMetadata` (and `raw`) from messenger event attachments before passing them to sub-agent Durable Objects.

Related issue: https://github.com/cloudflare/agents/issues/1833

**Status: confirmed present in `@cloudflare/think` 0.11.1** (latest as of 2026-06-29).

## The bug

The Telegram adapter stores the photo `file_id` exclusively in `fetchMetadata.fileId` on each attachment. When using a conversation resolver that routes to a sub-agent DO, `serializableMessengerEvent()` serializes the event for storage and cross-DO transmission. This function keeps only `id`, `mediaType`, `name`, `size`, `text`, and `url` from each attachment — dropping `fetchMetadata`, `raw`, and `fetch`.

For Telegram photos:
- The top-level `id` field is not set (file_id is only in `fetchMetadata`)
- After serialization, there is no way to identify or retrieve the photo from within the sub-agent

The relevant code in `@cloudflare/think` 0.11.1:

```js
// chat-sdk-D6cUghsQ.js
function serializableMessengerEvent(event) {
  return {
    // ...
    message: event.message ? {
      attachments: event.message.attachments.map((attachment) => ({
        id: attachment.id,       // undefined for Telegram photos
        mediaType: attachment.mediaType,
        name: attachment.name,
        size: attachment.size,
        text: attachment.text,
        url: attachment.url
        // fetchMetadata: dropped
        // raw: dropped
        // fetch: dropped
      })),
      // ...
    } : void 0,
  };
}
```

## Reproduction

1. Clone this repo and install dependencies:
   ```sh
   npm install
   cp .env.example .env
   # Fill in TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET_TOKEN
   npm run dev
   # Visit the printed tunnel URL + /setup to register the webhook
   ```

2. Send a photo to your bot.

3. Check the Worker logs (`npx wrangler tail`). You will see:
   ```
   BUG CONFIRMED: attachment.id and attachment.fetch are both missing.
   This is a sub-agent context — serializableMessengerEvent stripped fetchMetadata.
   ```

4. To see the working state, open `src/agent.ts` and switch to `conversation: "self"`. The same log will now show `hasFetch: true` and `rawFetchMetadata: { fileId: "AgACAgI..." }`.

## Expected behavior

`fetchMetadata` (or at minimum `id` populated from `fetchMetadata`) should survive `serializableMessengerEvent` so sub-agents can work with attachments requiring platform-specific identifiers.

## Workaround

Intercept the raw platform webhook before it reaches the Think framework, extract the file identifier from the raw payload, and inject it into the message text so it survives serialization.

See `workaround/index.ts` in this repo for the Telegram-specific implementation.

## Environment

- `@cloudflare/think`: 0.11.1
- `@chat-adapter/telegram`: 4.31.0
- `agents`: 0.17.1
- `wrangler`: 4.105.0
- Runtime: Cloudflare Workers + Durable Objects
