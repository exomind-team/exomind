export const VOICE_INPUT_TRANSCRIPT_TOPIC = 'voice.input.transcript';
export const USER_INPUT_TEXT_TOPIC = 'user.input.text';

export const VOICE_INPUT_NODE_ID = 'input:voice';
export const VOICE_INPUT_NODE_LABEL = 'Voice Input（语音输入）';
export const VOICE_INPUT_NODE_SUBTITLE = 'microphone / asr（麦克风 / 识别）';

export const KNOWN_AGENT_HUB_TOPICS = [
  VOICE_INPUT_TRANSCRIPT_TOPIC,
  USER_INPUT_TEXT_TOPIC,
  'session.end',
  'timeblock.completed',
  'input.classified',
  '*',
] as const;

export function isVoiceTranscriptTopic(topic: string): boolean {
  return topic === VOICE_INPUT_TRANSCRIPT_TOPIC;
}
