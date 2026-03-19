export type NativeMobileAgentConfig = {
  endpoint: string;
  authToken: string;
  agentId: string;
  user: string;
  promptText: string;
  promptInput?: OpenResponsesInputItem[];
  instructions?: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export type OpenResponsesInputText = {
  type: "input_text";
  text: string;
};

export type OpenResponsesInputImage = {
  type: "input_image";
  source:
    | {
        type: "url";
        url: string;
      }
    | {
        type: "base64";
        media_type: string;
        data: string;
      };
};

export type OpenResponsesInputFile = {
  type: "input_file";
  source:
    | {
        type: "url";
        url: string;
      }
    | {
        type: "base64";
        media_type: string;
        data: string;
        filename?: string;
      };
};

export type OpenResponsesInputContent =
  | OpenResponsesInputText
  | OpenResponsesInputImage
  | OpenResponsesInputFile;

export type OpenResponsesInputItem = {
  type: "message";
  role: "user";
  content: OpenResponsesInputContent[];
};

type OpenResponsesTextPart = {
  type?: string;
  text?: string;
};

type OpenResponsesMessage = {
  type?: string;
  content?: OpenResponsesTextPart[];
};

type OpenResponsesResponse = {
  id?: string;
  output_text?: string;
  output?: Array<OpenResponsesMessage | OpenResponsesTextPart>;
  error?: {
    message?: string;
  };
};

export async function runNativeMobileAgent(
  config: NativeMobileAgentConfig,
  fetchFn: typeof fetch = fetch
): Promise<{ replyText: string; runId: string }> {
  const response = await fetchFn(config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.authToken}`,
      "Content-Type": "application/json"
    },
    signal: config.signal,
    body: JSON.stringify({
      model: `openclaw:${config.agentId}`,
      user: config.user,
      input: config.promptInput ?? buildDefaultPromptInput(config.promptText),
      instructions: config.instructions,
      max_output_tokens: config.maxOutputTokens
    })
  });

  const payload = (await response.json().catch(() => ({}))) as OpenResponsesResponse;
  if (!response.ok) {
    const openResponsesNotEnabled =
      response.status === 404 && /\/v1\/responses(?:$|[/?#])/.test(config.endpoint);
    const message =
      payload.error?.message?.trim() ||
      (openResponsesNotEnabled
        ? "OpenClaw /v1/responses returned 404. Enable gateway.http.endpoints.responses.enabled in OpenClaw and restart the gateway."
        : `OpenClaw /v1/responses returned ${response.status}.`);
    throw new Error(message);
  }

  const replyText = extractOpenResponsesText(payload);
  if (!replyText) {
    throw new Error("OpenClaw native mobile agent returned no assistant text.");
  }

  return {
    replyText,
    runId: typeof payload.id === "string" ? payload.id : ""
  };
}

function buildDefaultPromptInput(promptText: string): OpenResponsesInputItem[] {
  return [
    {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: promptText
        }
      ]
    }
  ];
}

export function extractOpenResponsesText(payload: OpenResponsesResponse): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const textParts: string[] = [];
  for (const item of payload.output ?? []) {
    if (item && typeof item === "object" && item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part && typeof part === "object" && part.type === "output_text" && typeof part.text === "string") {
          const trimmed = part.text.trim();
          if (trimmed) {
            textParts.push(trimmed);
          }
        }
      }
      continue;
    }
    if (item && typeof item === "object" && item.type === "output_text" && typeof item.text === "string") {
      const trimmed = item.text.trim();
      if (trimmed) {
        textParts.push(trimmed);
      }
    }
  }

  return textParts.join("\n").trim();
}

export function buildNativeMobileAgentInstructions(): string {
  return [
    "You are the ZhiHand mobile agent running inside OpenClaw.",
    "Use zhihand tools when needed; do not invent phone state.",
    "Normal chat and phone-operation requests both use this same agent path.",
    "User prompts may include images, documents, voice-note transcripts, or video preview frames in the same request.",
    "Prefer zhihand_status first when pairing or capture state is unclear.",
    "Prefer zhihand_screen_read before taps or visual navigation when the current screen matters.",
    "If zhihand_screen_read reports a stale or unavailable screen, stop visual actions and ask the user to restore screen sharing.",
    "Use zhihand_control for actual phone actions.",
    "When using zhihand_control for visual actions, always send normalized coordinates from the latest screenshot.",
    "For click, long_click, and move_to use xRatio/yRatio in [0,1]. For swipe use x1Ratio/y1Ratio/x2Ratio/y2Ratio in [0,1]. Do not send screenshot pixel coordinates.",
    "Prefer deterministic actions such as open_app, home, back, and input_text before free-form tapping.",
    "For zhihand_control action input_text, default to mode='paste'. Use mode='type' only for sensitive text, passwords, or when paste clearly fails.",
    "When text entry should immediately confirm search, send, or submit, prefer zhihand_control action input_text with submit=true instead of clicking IME buttons.",
    "If text is already entered and the next step is to submit search, send, or confirm from the keyboard, prefer zhihand_control action enter instead of clicking the IME button.",
    "When the keyboard is visible, prefer back or enter over clicking keyboard chrome or tiny IME action buttons.",
    "Do not issue two visual taps or swipes back-to-back without a fresh zhihand_screen_read in between.",
    "After each zhihand_control call that changes the UI, treat the next 2 seconds as a settle window for the screen-capture pipeline.",
    "If the user is only chatting, answer normally without forcing tool calls.",
    "Keep replies concise and user-facing."
  ].join("\n");
}
