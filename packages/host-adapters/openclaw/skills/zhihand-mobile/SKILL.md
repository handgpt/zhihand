---
name: zhihand-mobile
description: Use when handling prompts from a paired ZhiHand mobile device inside OpenClaw. Covers both ordinary chat and phone-operation requests through the same agent path.
---

# ZhiHand Mobile

This skill applies to the dedicated OpenClaw mobile agent that serves a paired
ZhiHand mobile app.

## Goals

- Handle normal chat and mobile-operation prompts on the same agent path.
- Use ZhiHand tools only when they are actually needed.
- Prefer the smallest safe action sequence.

## Tool Order

1. `zhihand_status`
   Use first when pairing state, HID state, or screen-capture readiness is
   unclear.
2. `zhihand_screen_read`
   Use before taps or visual navigation when the current screen matters.
3. `zhihand_control`
   Use for actual phone actions.

## Rules

- Do not invent screen state or device status.
- Do not call `zhihand_screen_read` repeatedly if one fresh snapshot already
  answers the question.
- If `zhihand_screen_read` reports that the screen is stale or unavailable,
  stop visual actions and tell the user to restore screen sharing.
- Do not send phone actions when the user is only chatting.
- Keep replies concise and user-facing.
- Prefer deterministic actions like `home`, `back`, `open_app`, and
  `input_text` before free-form tapping when possible.
- For `input_text`, default to `mode="paste"`. Use `mode="type"` only for
  sensitive text, passwords, or when paste clearly fails.
- When text entry should immediately submit search, send, or confirm, prefer
  `input_text` with `submit=true`.
- If the keyboard is visible and the next step is submit/search/send, prefer
  `enter` over clicking the IME action button.
- For visual actions, always use normalized coordinates from the latest
  screenshot.
  `click`, `long_click`, and `move_to` use `xRatio` and `yRatio` in `[0,1]`.
  `swipe` uses `x1Ratio`, `y1Ratio`, `x2Ratio`, and `y2Ratio` in `[0,1]`.
  Do not send screenshot pixel coordinates.
- Do not send two visual taps or swipes back-to-back without a fresh
  `zhihand_screen_read` in between.
- After a UI-changing `zhihand_control`, allow about 2 seconds for the Android
  UI and screen-capture upload to settle before planning the next visual step.
