import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  downloadPromptAttachmentContent,
  type MobilePromptAttachmentRecord,
  type MobilePromptRecord,
  type ZhiHandPluginConfig
} from "./index.ts";
import type {
  OpenResponsesInputContent,
  OpenResponsesInputItem
} from "./native_mobile_agent.ts";

type OpenClawPluginApi = any;

type PairingLike = {
  credentialId: string;
  controllerToken: string;
};

type PreparedMobilePromptInput = {
  promptInput: OpenResponsesInputItem[];
  effectivePromptText: string;
};

const SUPPORTED_FILE_MIME_PREFIXES = [
  "text/",
  "application/pdf",
  "application/json",
  "text/markdown",
  "text/html",
  "text/csv"
];

export async function prepareMobilePromptInput(
  api: OpenClawPluginApi,
  config: ZhiHandPluginConfig,
  pairing: PairingLike,
  prompt: MobilePromptRecord,
  fetchFn: typeof fetch = fetch
): Promise<PreparedMobilePromptInput> {
  const contents: OpenResponsesInputContent[] = [];
  const contextNotes: string[] = [];
  const primaryAttachments = (prompt.attachments ?? []).filter((attachment) => attachment.purpose !== "preview");
  const previews = buildPreviewMap(prompt.attachments ?? []);

  for (const attachment of primaryAttachments) {
    switch (attachment.kind) {
      case "image":
        contents.push(await toImageInput(config, pairing, attachment, fetchFn));
        break;
      case "file":
        if (supportsNativeFileInput(attachment.mime_type)) {
          contents.push(await toFileInput(config, pairing, attachment, fetchFn));
        } else {
          contextNotes.push(
            `Unsupported file attachment retained for reference: ${attachment.file_name} (${attachment.mime_type || "application/octet-stream"}).`
          );
        }
        break;
      case "audio":
        contextNotes.push(await transcribeAudioAttachment(api, config, pairing, attachment, fetchFn));
        break;
      case "video": {
        const preview = resolvePreviewAttachment(attachment, previews);
        if (preview) {
          contents.push(await toImageInput(config, pairing, preview, fetchFn));
        }
        contextNotes.push(buildVideoContextNote(attachment, preview != null));
        break;
      }
      default:
        contextNotes.push(
          `Attachment retained for reference: ${attachment.file_name} (${attachment.mime_type || attachment.kind}).`
        );
        break;
    }
  }

  const textParts = [prompt.text.trim(), ...contextNotes.map((note) => note.trim())].filter(Boolean);
  const effectivePromptText = textParts.join("\n\n").trim();
  if (effectivePromptText) {
    contents.unshift({
      type: "input_text",
      text: effectivePromptText
    });
  } else if (contents.length > 0) {
    contents.unshift({
      type: "input_text",
      text: "Please review the attached media and respond helpfully."
    });
  }

  return {
    promptInput: [
      {
        role: "user",
        content: contents
      }
    ],
    effectivePromptText
  };
}

function buildPreviewMap(attachments: MobilePromptAttachmentRecord[]): Map<string, MobilePromptAttachmentRecord> {
  const map = new Map<string, MobilePromptAttachmentRecord>();
  for (const attachment of attachments) {
    if (attachment.purpose !== "preview") {
      continue;
    }
    const key = attachment.parent_client_attachment_id?.trim() || attachment.client_attachment_id?.trim() || "";
    if (!key || map.has(key)) {
      continue;
    }
    map.set(key, attachment);
  }
  return map;
}

function resolvePreviewAttachment(
  attachment: MobilePromptAttachmentRecord,
  previews: Map<string, MobilePromptAttachmentRecord>
): MobilePromptAttachmentRecord | null {
  const key = attachment.client_attachment_id?.trim() || "";
  if (!key) {
    return null;
  }
  return previews.get(key) ?? null;
}

async function toImageInput(
  config: ZhiHandPluginConfig,
  pairing: PairingLike,
  attachment: MobilePromptAttachmentRecord,
  fetchFn: typeof fetch
): Promise<OpenResponsesInputContent> {
  const downloaded = await downloadPromptAttachmentContent(
    config,
    {
      credentialId: pairing.credentialId,
      controllerToken: pairing.controllerToken,
      attachmentId: attachment.id
    },
    fetchFn
  );
  return {
    type: "input_image",
    image_url: buildDataUrl(downloaded.mimeType, downloaded.content)
  };
}

async function toFileInput(
  config: ZhiHandPluginConfig,
  pairing: PairingLike,
  attachment: MobilePromptAttachmentRecord,
  fetchFn: typeof fetch
): Promise<OpenResponsesInputContent> {
  const downloaded = await downloadPromptAttachmentContent(
    config,
    {
      credentialId: pairing.credentialId,
      controllerToken: pairing.controllerToken,
      attachmentId: attachment.id
    },
    fetchFn
  );
  return {
    type: "input_file",
    filename: downloaded.fileName,
    file_data: buildDataUrl(downloaded.mimeType, downloaded.content)
  };
}

async function transcribeAudioAttachment(
  api: OpenClawPluginApi,
  config: ZhiHandPluginConfig,
  pairing: PairingLike,
  attachment: MobilePromptAttachmentRecord,
  fetchFn: typeof fetch
): Promise<string> {
  if (typeof api.runtime?.stt?.transcribeAudioFile !== "function") {
    return "A voice note was attached, but speech-to-text is not available on this OpenClaw runtime.";
  }
  const downloaded = await downloadPromptAttachmentContent(
    config,
    {
      credentialId: pairing.credentialId,
      controllerToken: pairing.controllerToken,
      attachmentId: attachment.id
    },
    fetchFn
  );

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhihand-audio-"));
  const tempPath = path.join(tempDir, sanitizeTempFileName(downloaded.fileName || "voice.m4a"));
  try {
    await fs.writeFile(tempPath, downloaded.content);
    const transcriptResult = await api.runtime.stt.transcribeAudioFile({ path: tempPath });
    const transcript = normalizeTranscriptText(transcriptResult);
    if (transcript) {
      return `Voice note transcript:\n${transcript}`;
    }
    return "A voice note was attached, but transcription returned no text.";
  } catch (error) {
    return `A voice note was attached, but transcription failed: ${errorMessage(error)}.`;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function supportsNativeFileInput(mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase();
  return SUPPORTED_FILE_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function buildVideoContextNote(
  attachment: MobilePromptAttachmentRecord,
  hasPreview: boolean
): string {
  const bits = [`Video attachment: ${attachment.file_name}`];
  if (attachment.duration_ms && attachment.duration_ms > 0) {
    bits.push(`duration ${Math.round(attachment.duration_ms / 1000)}s`);
  }
  if (hasPreview) {
    bits.push("a representative preview frame is attached");
  }
  bits.push("use the preview for visible UI details, and ask for a still frame if motion-specific detail matters");
  return bits.join("; ") + ".";
}

function buildDataUrl(mimeType: string, content: Uint8Array): string {
  const resolvedMime = mimeType.trim() || "application/octet-stream";
  return `data:${resolvedMime};base64,${Buffer.from(content).toString("base64")}`;
}

function sanitizeTempFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function normalizeTranscriptText(result: unknown): string {
  if (typeof result === "string") {
    return result.trim();
  }
  if (result && typeof result === "object") {
    const candidate =
      (result as { text?: string }).text ??
      (result as { transcript?: string }).transcript ??
      "";
    if (typeof candidate === "string") {
      return candidate.trim();
    }
  }
  return "";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "unknown error";
}
