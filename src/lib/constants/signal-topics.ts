export const VOICE_INPUT_TRANSCRIPT_TOPIC = 'voice.input.transcript';
export const VOICE_STREAM_PARTIAL_TOPIC = 'voice.stream.partial';
export const VOICE_RUNTIME_STATE_UPDATED_TOPIC = 'voice.runtime.state.updated';
export const VOICE_RUNTIME_MODE_CHANGED_TOPIC = 'voice.runtime.mode.changed';
export const VOICE_RUNTIME_SPEAK_REQUEST_TOPIC = 'voice.runtime.speak.request';
export const VOICE_RUNTIME_SPEAK_CANCEL_TOPIC = 'voice.runtime.speak.cancel';
export const USER_INPUT_TEXT_TOPIC = 'user.input.text';
export const USER_INPUT_NORMALIZED_TOPIC = 'user.input.normalized';
export const EXTERNAL_INPUT_RECEIVED_TOPIC = 'external.input.received';
export const EXTERNAL_INPUT_INGESTED_TOPIC = 'external.input.ingested';

export const VOICE_INPUT_NODE_ID = 'input:voice';
export const VOICE_INPUT_NODE_LABEL = 'Voice Input（语音输入）';
export const VOICE_INPUT_NODE_SUBTITLE = 'microphone / asr（麦克风 / 识别）';

export const KNOWN_AGENT_HUB_TOPICS = [
  VOICE_INPUT_TRANSCRIPT_TOPIC,
  VOICE_STREAM_PARTIAL_TOPIC,
  VOICE_RUNTIME_STATE_UPDATED_TOPIC,
  VOICE_RUNTIME_MODE_CHANGED_TOPIC,
  VOICE_RUNTIME_SPEAK_REQUEST_TOPIC,
  VOICE_RUNTIME_SPEAK_CANCEL_TOPIC,
  USER_INPUT_TEXT_TOPIC,
  USER_INPUT_NORMALIZED_TOPIC,
  EXTERNAL_INPUT_RECEIVED_TOPIC,
  EXTERNAL_INPUT_INGESTED_TOPIC,
  '*',
] as const;

export function isVoiceTranscriptTopic(topic: string): boolean {
  return topic === VOICE_INPUT_TRANSCRIPT_TOPIC;
}
