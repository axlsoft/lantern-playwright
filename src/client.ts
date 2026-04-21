export interface EmitPayload {
  runId: string;
  payload: unknown;
}

export async function emitCoverageEvent(endpoint: string, data: EmitPayload): Promise<void> {
  await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data)
  });
}
