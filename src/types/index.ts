import { z } from "zod";

export const ConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  activeProjectSlug: z.string().optional(),
  projects: z
    .record(
      z.string(),
      z.object({
        slug: z.string(),
        projectRef: z.string().optional(),
        dbUrl: z.string().optional(),
        createdAt: z.string().datetime().optional(),
      })
    )
    .optional()
    .default({}),
});
export type Config = z.infer<typeof ConfigSchema>;

export const MessageRoleSchema = z.enum(["user", "assistant", "system"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const ConversationMessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.string(),
  timestamp: z.string().datetime().optional(),
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
