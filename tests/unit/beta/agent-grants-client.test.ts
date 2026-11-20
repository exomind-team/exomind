import { describe, expect, it, vi } from "vitest";
import {
  AgentGrantClientError,
  createAgentGrantsClient,
  type AgentGrantNativeInvoke,
  type AgentGrantMetadata,
} from "@/beta/agent-grants-client";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const GRANT_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "33333333-3333-4333-8333-333333333333";
const HANDLE = "44444444-4444-4444-8444-444444444444";

function metadata(
  overrides: Partial<AgentGrantMetadata> = {},
): AgentGrantMetadata {
  return {
    grant_id: GRANT_ID,
    profile_id: PROFILE_ID,
    kind: "observer",
    agent_id: null,
    revoked: false,
    ...overrides,
  };
}

function invokeReturning(value: unknown) {
  return vi.fn(
    async (_command: string, _args?: Record<string, unknown>) => value,
  ) as unknown as AgentGrantNativeInvoke;
}

describe("Native Agent grants client contract", () => {
  it("maps all six commands to the exact Tauri argument casing", async () => {
    const revoked = metadata({ revoked: true });
    const nativeInvoke = vi.fn(
      async (command: string, args?: Record<string, unknown>) => {
        switch (command) {
          case "beta_grant_metadata_list":
            return [metadata()];
          case "beta_grant_issue": {
            const issue = args?.command as {
              grant_id: string;
              profile_id: string;
              kind: AgentGrantMetadata["kind"];
              agent_id: string | null;
            };
            return {
              grant: metadata({
                grant_id: issue.grant_id,
                profile_id: issue.profile_id,
                kind: issue.kind,
                agent_id: issue.agent_id,
              }),
              issuance: "created",
              credential_handle: HANDLE,
              credential_state: "available",
            };
          }
          case "beta_grant_recover":
            return {
              grant: metadata(),
              issuance: "created",
              credential_handle: HANDLE,
              credential_state: "available",
            };
          case "beta_grant_revoke":
            return {
              grant: revoked,
              credential_material_released: true,
              completion: "confirmed",
            };
          case "beta_grant_copy_access_info":
            return {
              credential_handle: HANDLE,
              credential_state: "copied",
              material_retained: true,
            };
          case "beta_grant_release_credential":
            return { material_released: true, credential_state: "unavailable" };
          default:
            throw new Error("unexpected command");
        }
      },
    );
    const invoke = nativeInvoke as unknown as AgentGrantNativeInvoke;
    const client = createAgentGrantsClient(invoke);
    const command = {
      grant_id: GRANT_ID,
      profile_id: PROFILE_ID,
      kind: "agent_note" as const,
      agent_id: AGENT_ID,
    };

    await client.list(PROFILE_ID);
    await client.issue(command);
    await client.recover(PROFILE_ID, GRANT_ID);
    await client.revoke(PROFILE_ID, GRANT_ID);
    await client.copyAccessInfo(PROFILE_ID, GRANT_ID, HANDLE);
    await client.releaseCredential(PROFILE_ID, HANDLE);

    expect(nativeInvoke.mock.calls).toEqual([
      ["beta_grant_metadata_list", { profileId: PROFILE_ID }],
      ["beta_grant_issue", { command }],
      ["beta_grant_recover", { profileId: PROFILE_ID, grantId: GRANT_ID }],
      ["beta_grant_revoke", { profileId: PROFILE_ID, grantId: GRANT_ID }],
      [
        "beta_grant_copy_access_info",
        { profileId: PROFILE_ID, grantId: GRANT_ID, credentialHandle: HANDLE },
      ],
      [
        "beta_grant_release_credential",
        { profileId: PROFILE_ID, credentialHandle: HANDLE },
      ],
    ]);
  });

  it("rejects human, unknown request fields, invalid IDs, and mismatched or expanded metadata", async () => {
    const invoke = invokeReturning([metadata()]);
    const client = createAgentGrantsClient(invoke);

    await expect(client.list("C:/another-profile")).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(
      client.issue({
        grant_id: GRANT_ID,
        profile_id: PROFILE_ID,
        kind: "human",
        agent_id: null,
      } as never),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      client.issue({
        grant_id: GRANT_ID,
        profile_id: PROFILE_ID,
        kind: "observer",
        agent_id: null,
        ttl: 60,
      } as never),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(client.list(PROFILE_ID)).resolves.toEqual([metadata()]);

    const wrongProfile = createAgentGrantsClient(
      invokeReturning([metadata({ profile_id: AGENT_ID })]),
    );
    await expect(wrongProfile.list(PROFILE_ID)).rejects.toMatchObject({
      code: "invalid_response",
    });

    const unknownField = createAgentGrantsClient(
      invokeReturning([{ ...metadata(), created_at: 1 }]),
    );
    await expect(unknownField.list(PROFILE_ID)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("requires Agent IDs only for writing roles and rejects human or unknown response enums", async () => {
    const invoke = invokeReturning({
      grant: metadata({ kind: "agent_note", agent_id: AGENT_ID }),
      issuance: "created",
      credential_handle: HANDLE,
      credential_state: "available",
    });
    const client = createAgentGrantsClient(invoke);

    await expect(
      client.issue({
        grant_id: GRANT_ID,
        profile_id: PROFILE_ID,
        kind: "agent_note",
        agent_id: null,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      client.issue({
        grant_id: GRANT_ID,
        profile_id: PROFILE_ID,
        kind: "observer",
        agent_id: AGENT_ID,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      client.issue({
        grant_id: GRANT_ID,
        profile_id: PROFILE_ID,
        kind: "observer",
        agent_id: null,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });

    const humanResponse = createAgentGrantsClient(
      invokeReturning([metadata({ kind: "human" as never })]),
    );
    await expect(humanResponse.list(PROFILE_ID)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("maps an unexpected Native error to safe text without retaining its arbitrary message", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("unexpected native detail at private/path");
    }) as unknown as AgentGrantNativeInvoke;
    const client = createAgentGrantsClient(invoke);
    const failure = await client.list(PROFILE_ID).then(
      () => null,
      (error) => error as AgentGrantClientError,
    );

    expect(failure).toBeInstanceOf(AgentGrantClientError);
    expect(failure).toMatchObject({ code: "native_unavailable" });
    expect(failure?.message).not.toContain("private/path");
    expect(JSON.stringify(failure)).not.toContain("unexpected native detail");
  });

  it("never expects or returns a raw credential value from issue or copy", async () => {
    const invoke = vi.fn(async (command: string) =>
      command === "beta_grant_copy_access_info"
        ? {
            credential_handle: HANDLE,
            credential_state: "copied",
            material_retained: true,
          }
        : {
            grant: metadata(),
            issuance: "created",
            credential_handle: HANDLE,
            credential_state: "available",
          },
    ) as unknown as AgentGrantNativeInvoke;
    const client = createAgentGrantsClient(invoke);
    const issued = await client.issue({
      grant_id: GRANT_ID,
      profile_id: PROFILE_ID,
      kind: "observer",
      agent_id: null,
    });
    const copied = await client.copyAccessInfo(PROFILE_ID, GRANT_ID, HANDLE);

    expect(issued).toEqual({
      grant: metadata(),
      issuance: "created",
      credential_handle: HANDLE,
      credential_state: "available",
    });
    expect(copied).toEqual({
      credential_handle: HANDLE,
      credential_state: "copied",
      material_retained: true,
    });
    expect(JSON.stringify({ issued, copied })).not.toContain("token");
  });
});
