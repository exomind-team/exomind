# Voice Overlay Soft Floating Card Design

**Status:** Design approved for implementation（设计已确认，可进入实现）

**Goal:** Upgrade the voice overlay into a softer floating card that keeps the user focused on live transcript text while adding subtle audio-reactive edge breathing.

## User Intent

### 1. Live transcript remains the visual focus

- The primary focus must stay on `streaming transcript text（流式识别文字）`.
- Visual motion must not steal attention from the text.
- Transcript text size should be increased slightly in recording / recognizing states.

### 2. Card separation from background should improve

- The overlay must feel more distinct from background windows.
- The card should gain depth through:
  - a soft outline（柔和描边）
  - a stronger but still restrained shadow（克制阴影）
  - a faint highlight / halo（轻微高光 / 外晕）

### 3. Audio feedback should live on the card edge

- Audio-reactive feedback should appear mainly on the card edge.
- The microphone can keep its existing pulse, but it must not become the main animation surface.
- The card edge should breathe with input volume in a subtle way.

## Recommended Visual Direction

### Base card

- Keep current rounded floating card structure.
- Add:
  - thin cool-toned border
  - soft outer shadow
  - very light outer halo
- Avoid strong 3D bevels or hard neon looks.

### Transcript hierarchy

- Recording / recognizing transcript text should be larger and slightly heavier than secondary copy.
- Secondary status text and diagnostics must stay visually quieter.

### Motion language

- Use `audio-reactive edge breath（音量驱动的边缘呼吸）`.
- The motion should control:
  - border brightness
  - outer halo intensity
  - shadow spread / glow strength
- No large scaling or bouncing on the whole card.

## Color Direction

- Preferred accent direction: `cool tone（冷色）`
- Recommended family:
  - cyan / teal edge tint
  - restrained icy glow on dark card
- Reason:
  - cleaner on black translucent backgrounds
  - less likely to feel noisy than warm orange glow

## Non-Goals

- No major layout redesign.
- No waveform-heavy UI for this iteration.
- No large mic scaling tied to volume.
- No strong animated gradients around the whole card.

## Acceptance Criteria

- Users notice transcript text before they notice the border animation.
- The card is more visually separated from the background than before.
- During recording, card edge breathing responds to audio level but stays subtle.
- The microphone remains secondary to the transcript.

