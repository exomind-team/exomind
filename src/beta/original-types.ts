export const ORIGINAL_CHUNK_BYTES = 256 * 1024;

export interface BetaOriginal {
  original_id: string;
  sha256: string;
  byte_length: number;
  file_name: string;
  media_type: string;
}

export interface BetaBeginStage {
  stage_id: string;
  original_id: string;
  profile_id: string;
  expected_sha256: string;
  byte_length: number;
  file_name: string;
  media_type: string;
}

export interface BetaStage {
  stage_id: string;
  profile_id: string;
  original: BetaOriginal;
  state: 'uploading' | 'frozen' | 'verified' | 'hash_mismatch';
  next_offset: number;
  generation: number;
}

export interface BetaOriginalClient {
  begin(command: BetaBeginStage): Promise<BetaStage>;
  status(profileId: string, stageId: string): Promise<BetaStage>;
  write(profileId: string, stageId: string, offset: number, bytes: Uint8Array): Promise<BetaStage>;
  verify(profileId: string, stageId: string): Promise<BetaStage>;
  readStage(profileId: string, stageId: string, offset: number, length: number): Promise<Uint8Array>;
  readOriginal(profileId: string, originalId: string, offset: number, length: number): Promise<Uint8Array>;
}
