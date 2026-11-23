/** @param {object} env Worker bindings and vars */
export function readConfig(env) {
  const ids = String(env.ALLOWED_EXTENSION_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length || ids.some((id) => !/^[a-p]{32}$/.test(id))) {
    throw new Error("ALLOWED_EXTENSION_IDS must be one or more 32-letter chrome extension ids (a-p)");
  }
  const trialKeyHash = String(env.TRIAL_KEY_HASH || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(trialKeyHash)) {
    throw new Error("TRIAL_KEY_HASH must be a 64-char sha256 hex digest");
  }
  const trialMax = Number(env.TRIAL_MAX_ACTIVATIONS ?? 10000);
  const defaultMax = Number(env.DEFAULT_MAX_ACTIVATIONS ?? 5);
  if (!Number.isInteger(trialMax) || trialMax < 1 || !Number.isInteger(defaultMax) || defaultMax < 1) {
    throw new Error("activation caps must be positive integers");
  }
  if (!env.KEYS) throw new Error("KEYS KV binding is missing");
  return {
    allowedExtensionIds: ids,
    trialKeyHash,
    trialMaxActivations: trialMax,
    defaultMaxActivations: defaultMax,
    adminSecret: typeof env.LICENSE_ADMIN_SECRET === "string" ? env.LICENSE_ADMIN_SECRET : "",
    kv: env.KEYS,
  };
}
