# Lotwise license Worker

Soft gate for newest-set card data (`catalogExtra`). Core scanning stays free.

## Deploy

```powershell
cd tools/license
npx wrangler kv namespace create LOTWISE_LICENSE
# paste the id into wrangler.toml [[kv_namespaces]] id =
npx wrangler secret put LICENSE_ADMIN_SECRET
npx wrangler deploy
```

Public URL shape: `https://lotwise-license.<account>.workers.dev` — set that as `LICENSE_URL` in `tools/extension-wasm/lib/shared-config.js` (with `/` trimmed; the extension appends `/v1/activate` and `/v1/check`).

## Trial key

Plaintext trial key (publish in README while previewing): `LOTWISE-TRIAL`  
Its SHA-256 is `TRIAL_KEY_HASH` in `wrangler.toml`. First activate seeds the KV record.

## Admin

```powershell
# Create a paid key
curl -X POST https://<worker>/v1/admin/keys -H "content-type: application/json" -H "x-lotwise-admin: $SECRET" -d "{\"key\":\"YOUR-PAID-KEY\",\"plan\":\"paid\",\"maxActivations\":3}"

# Revoke (including the trial key)
curl -X POST https://<worker>/v1/admin/revoke -H "content-type: application/json" -H "x-lotwise-admin: $SECRET" -d "{\"key\":\"LOTWISE-TRIAL\"}"
```
