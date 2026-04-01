import { spawn } from "node:child_process";
const CLI_TIMEOUT = 120_000; // 120s
const SIGKILL_DELAY = 2_000; // 2s after SIGTERM
const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB
const BACKENDS = {
    gemini: {
        command: "gemini",
        buildArgs: (prompt, model) => [
            "--approval-mode", "yolo",
            "--model", model ?? process.env.CLAUDE_GEMINI_MODEL ?? "gemini-3.1-pro-preview",
            "-i", prompt,
        ],
        env: {
            GEMINI_SANDBOX: "false",
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
        },
    },
    claudecode: {
        command: "claude",
        buildArgs: (prompt) => ["-p", prompt, "--output-format", "json"],
    },
    codex: {
        command: "codex",
        buildArgs: (prompt) => ["-q", prompt, "--json"],
    },
};
let activeChild = null;
/**
 * Kill the active child process. Returns a promise that resolves
 * when the child has exited (or immediately if no child).
 */
export function killActiveChild() {
    if (!activeChild || activeChild.killed) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const child = activeChild;
        child.once("close", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => {
            if (!child.killed) {
                child.kill("SIGKILL");
            }
        }, SIGKILL_DELAY);
        // Safety: resolve after SIGKILL_DELAY + 1s even if no close event
        setTimeout(() => resolve(), SIGKILL_DELAY + 1000);
    });
}
export function dispatchToCLI(backend, prompt, model) {
    const config = BACKENDS[backend];
    if (!config) {
        return Promise.resolve({
            text: `Unsupported backend: ${backend}`,
            success: false,
            durationMs: 0,
        });
    }
    const startTime = Date.now();
    const args = config.buildArgs(prompt, model);
    const env = { ...process.env, ...config.env };
    return new Promise((resolve) => {
        const chunks = [];
        let totalBytes = 0;
        let truncated = false;
        let settled = false;
        function settle(result) {
            if (settled)
                return;
            settled = true;
            resolve(result);
        }
        const child = spawn(config.command, args, {
            env,
            stdio: ["ignore", "pipe", "pipe"],
            detached: false,
        });
        activeChild = child;
        // Timeout with two-stage kill
        const timer = setTimeout(() => {
            child.kill("SIGTERM");
            setTimeout(() => {
                if (!child.killed)
                    child.kill("SIGKILL");
            }, SIGKILL_DELAY);
        }, CLI_TIMEOUT);
        const collectOutput = (data) => {
            if (truncated)
                return;
            totalBytes += data.length;
            if (totalBytes > MAX_OUTPUT_BYTES) {
                truncated = true;
                chunks.push(data.subarray(0, MAX_OUTPUT_BYTES - (totalBytes - data.length)));
            }
            else {
                chunks.push(data);
            }
        };
        child.stdout?.on("data", collectOutput);
        child.stderr?.on("data", collectOutput);
        child.on("close", (code) => {
            clearTimeout(timer);
            activeChild = null;
            const durationMs = Date.now() - startTime;
            let text = Buffer.concat(chunks).toString("utf8").trim();
            if (truncated) {
                text += "\n\n[Output truncated at 100KB]";
            }
            if (!text) {
                text = code === 0
                    ? "Task completed (no output)."
                    : `CLI process exited with code ${code}.`;
            }
            settle({ text, success: code === 0, durationMs });
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            activeChild = null;
            settle({
                text: `CLI launch failed: ${err.message}`,
                success: false,
                durationMs: Date.now() - startTime,
            });
        });
    });
}
export async function postReply(config, promptId, text) {
    try {
        const url = `${config.controlPlaneEndpoint}/v1/credentials/${encodeURIComponent(config.credentialId)}/prompts/${encodeURIComponent(promptId)}/reply`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-zhihand-controller-token": config.controllerToken,
            },
            body: JSON.stringify({ role: "assistant", text }),
            signal: AbortSignal.timeout(30_000),
        });
        // 4xx = prompt cancelled, that's OK
        return response.ok || (response.status >= 400 && response.status < 500);
    }
    catch {
        return false;
    }
}
