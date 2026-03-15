import test from "node:test";
import assert from "node:assert/strict";

import { prepareMobilePromptInput } from "./mobile_prompt_media.ts";
import type { MobilePromptRecord, ZhiHandPluginConfig } from "./index.ts";

const config: ZhiHandPluginConfig = {
  controlPlaneEndpoint: "https://api.zhihand.test"
};

test("prepareMobilePromptInput maps attachments into multimodal native-agent input", async () => {
  const prompt: MobilePromptRecord = {
    id: "prm_1",
    credential_id: "crd_1",
    edge_id: "edge_1",
    text: "Handle these attachments.",
    status: "processing",
    created_at: "2026-03-16T00:00:00Z",
    attachments: [
      {
        id: "att_img",
        credential_id: "crd_1",
        edge_id: "edge_1",
        kind: "image",
        file_name: "screen.jpg",
        mime_type: "image/jpeg",
        byte_size: 10,
        created_at: "2026-03-16T00:00:00Z"
      },
      {
        id: "att_audio",
        credential_id: "crd_1",
        edge_id: "edge_1",
        kind: "audio",
        file_name: "voice.m4a",
        mime_type: "audio/mp4",
        byte_size: 10,
        created_at: "2026-03-16T00:00:00Z"
      },
      {
        id: "att_video",
        credential_id: "crd_1",
        edge_id: "edge_1",
        client_attachment_id: "video-1",
        kind: "video",
        file_name: "clip.mp4",
        mime_type: "video/mp4",
        byte_size: 10,
        duration_ms: 4200,
        created_at: "2026-03-16T00:00:00Z"
      },
      {
        id: "att_video_preview",
        credential_id: "crd_1",
        edge_id: "edge_1",
        client_attachment_id: "preview-1",
        parent_client_attachment_id: "video-1",
        kind: "image",
        purpose: "preview",
        file_name: "clip.preview.jpg",
        mime_type: "image/jpeg",
        byte_size: 10,
        created_at: "2026-03-16T00:00:00Z"
      },
      {
        id: "att_pdf",
        credential_id: "crd_1",
        edge_id: "edge_1",
        kind: "file",
        file_name: "notes.pdf",
        mime_type: "application/pdf",
        byte_size: 10,
        created_at: "2026-03-16T00:00:00Z"
      },
      {
        id: "att_bin",
        credential_id: "crd_1",
        edge_id: "edge_1",
        kind: "file",
        file_name: "dump.bin",
        mime_type: "application/octet-stream",
        byte_size: 10,
        created_at: "2026-03-16T00:00:00Z"
      }
    ]
  };

  const fetchCalls: string[] = [];
  const prepared = await prepareMobilePromptInput(
    {
      runtime: {
        stt: {
          async transcribeAudioFile() {
            return { text: "hello from voice" };
          }
        }
      }
    },
    config,
    {
      credentialId: "crd_1",
      controllerToken: "ctl_1"
    },
    prompt,
    async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push(url);
      const attachmentId = url.split("/attachments/")[1]?.split("/content")[0];
      const mimeType =
        attachmentId === "att_pdf" ? "application/pdf" : "image/jpeg";
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "content-type": mimeType,
          "content-disposition": `inline; filename="${attachmentId}.bin"`
        }
      });
    }
  );

  assert.equal(fetchCalls.length, 4);
  const content = prepared.promptInput[0]?.content ?? [];
  assert.equal(content[0]?.type, "input_text");
  assert.match((content[0] as { text: string }).text, /hello from voice/);
  assert.match((content[0] as { text: string }).text, /Video attachment: clip\.mp4/);
  assert.match((content[0] as { text: string }).text, /Unsupported file attachment retained for reference/);
  assert.equal(content.filter((item) => item.type === "input_image").length, 2);
  assert.equal(content.filter((item) => item.type === "input_file").length, 1);
});

test("prepareMobilePromptInput falls back cleanly when STT is unavailable", async () => {
  const prompt: MobilePromptRecord = {
    id: "prm_audio_only",
    credential_id: "crd_1",
    edge_id: "edge_1",
    text: "",
    status: "processing",
    created_at: "2026-03-16T00:00:00Z",
    attachments: [
      {
        id: "att_audio",
        credential_id: "crd_1",
        edge_id: "edge_1",
        kind: "audio",
        file_name: "voice.m4a",
        mime_type: "audio/mp4",
        byte_size: 10,
        created_at: "2026-03-16T00:00:00Z"
      }
    ]
  };

  const prepared = await prepareMobilePromptInput(
    { runtime: {} },
    config,
    {
      credentialId: "crd_1",
      controllerToken: "ctl_1"
    },
    prompt,
    async () => {
      throw new Error("audio should not be fetched when STT is unavailable");
    }
  );

  const firstItem = prepared.promptInput[0]?.content?.[0];
  assert.equal(firstItem?.type, "input_text");
  assert.match(
    (firstItem as { text: string }).text,
    /speech-to-text is not available/i
  );
});

test("prepareMobilePromptInput reports empty STT results without failing the prompt", async () => {
  const prompt: MobilePromptRecord = {
    id: "prm_audio_empty",
    credential_id: "crd_1",
    edge_id: "edge_1",
    text: "",
    status: "processing",
    created_at: "2026-03-16T00:00:00Z",
    attachments: [
      {
        id: "att_audio",
        credential_id: "crd_1",
        edge_id: "edge_1",
        kind: "audio",
        file_name: "voice.m4a",
        mime_type: "audio/mp4",
        byte_size: 10,
        created_at: "2026-03-16T00:00:00Z"
      }
    ]
  };

  const prepared = await prepareMobilePromptInput(
    {
      runtime: {
        stt: {
          async transcribeAudioFile() {
            return { text: "   " };
          }
        }
      }
    },
    config,
    {
      credentialId: "crd_1",
      controllerToken: "ctl_1"
    },
    prompt,
    async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "content-type": "audio/mp4",
          "content-disposition": 'inline; filename="voice.m4a"'
        }
      })
  );

  const firstItem = prepared.promptInput[0]?.content?.[0];
  assert.equal(firstItem?.type, "input_text");
  assert.match(
    (firstItem as { text: string }).text,
    /transcription returned no text/i
  );
});
