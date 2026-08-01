const L720_BACKEND_URL = process.env.L720_BACKEND_URL || "http://localhost:3000";

type DispatchOptions = {
  since?: number;
  reconcileMissing?: boolean;
};

export async function notifyL720BackendOf811Change(
  options: DispatchOptions = {},
) {
  const { since, reconcileMissing = false } = options;

  try {
    const response = await fetch(`${L720_BACKEND_URL}/api/inbound/811/pull`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assign: true,
        reconcileMissing,
        ...(since !== undefined ? { since: Math.max(0, since) } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`L720 backend returned ${response.status}`);
    }

    const result = await response.json();
    console.log("[811 Dispatch] L720 backend notified:", result.message);
  } catch (error) {
    console.error("[811 Dispatch] Failed to notify L720 backend:", error);
  }
}
