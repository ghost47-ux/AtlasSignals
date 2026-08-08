/**
 * telegram.ts — Telegram Bot API update schema.
 *
 * Minimal structure needed by the backend's bot webhook: we only act on
 * `message.text` (commands like /start <code>) plus the chat id to reply to.
 * Everything else passes through untouched (`.passthrough()`), so Telegram's
 * full update shape is preserved for debugging.
 */
import { z } from 'zod';

export const telegramUpdateSchema = z
  .object({
    update_id: z.number().int(),
    message: z
      .object({
        message_id: z.number().int(),
        from: z
          .object({
            id: z.number().int(),
            is_bot: z.boolean().optional(),
            first_name: z.string().optional(),
            username: z.string().optional(),
          })
          .optional(),
        chat: z.object({
          id: z.number().int(),
          type: z.string(),
          first_name: z.string().optional(),
          username: z.string().optional(),
        }),
        date: z.number().int().optional(),
        text: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
