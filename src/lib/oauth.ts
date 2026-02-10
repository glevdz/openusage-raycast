/**
 * Shared OAuth helpers for token refresh across providers.
 */

export interface RefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  idToken?: string;
}

/**
 * Perform an OAuth token refresh with JSON body (Claude style).
 */
export async function refreshTokenJson(params: {
  url: string;
  clientId: string;
  refreshToken: string;
  scope?: string;
  extraBody?: Record<string, string>;
}): Promise<RefreshResult | null> {
  const body: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    ...params.extraBody,
  };

  if (params.scope) {
    body.scope = params.scope;
  }

  const resp = await fetch(params.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (resp.status === 400 || resp.status === 401) {
    const data = (await resp.json().catch(() => null)) as Record<string, string> | null;
    const errorCode = data?.error || data?.error_description || "";
    if (errorCode === "invalid_grant") {
      throw new Error("Session expired. Please re-authenticate.");
    }
    throw new Error(`Token refresh failed (${resp.status}): ${errorCode}`);
  }

  if (!resp.ok) return null;

  const data = (await resp.json()) as Record<string, unknown>;
  if (!data.access_token) return null;

  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string | undefined,
    expiresIn: data.expires_in as number | undefined,
    idToken: data.id_token as string | undefined,
  };
}

/**
 * Perform an OAuth token refresh with form-urlencoded body (Codex/Kimi style).
 */
export async function refreshTokenForm(params: {
  url: string;
  clientId: string;
  refreshToken: string;
  extraParams?: Record<string, string>;
}): Promise<RefreshResult | null> {
  const formParts = [
    `grant_type=refresh_token`,
    `client_id=${encodeURIComponent(params.clientId)}`,
    `refresh_token=${encodeURIComponent(params.refreshToken)}`,
  ];

  if (params.extraParams) {
    for (const [key, value] of Object.entries(params.extraParams)) {
      formParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }

  const resp = await fetch(params.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: formParts.join("&"),
  });

  if (resp.status === 400 || resp.status === 401) {
    const data = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
    const code =
      (data?.error as Record<string, string>)?.code ||
      (data?.error as string) ||
      (data?.code as string) ||
      "";
    throw new Error(`Token refresh failed (${resp.status}): ${code}`);
  }

  if (!resp.ok) return null;

  const data = (await resp.json()) as Record<string, unknown>;
  if (!data.access_token) return null;

  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string | undefined,
    expiresIn: data.expires_in as number | undefined,
    idToken: data.id_token as string | undefined,
  };
}
