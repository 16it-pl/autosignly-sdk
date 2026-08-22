# autosignly

Command line tool for [Autosignly](https://autosignly.eu). It opens a stream of
your webhook events and forwards them to a local address, so you can develop an
integration on your own machine without exposing it to the internet.

```bash
npm install -g autosignly
```

Requires Node 20 or newer.

## Signing in

```bash
autosignly login
```

You are asked for the API key and secret created in the Autosignly application;
the secret is read without echoing and never appears in your shell history.
Credentials are stored in `~/.config/autosignly/credentials.json`, keyed by API
address, so a production and a sandbox login can live side by side.

The tool prints which company and environment the key resolves to, and warns you
loudly when it belongs to production.

## Forwarding events

```bash
autosignly listen --forward-to http://localhost:8000/webhooks/autosignly
```

Every event is delivered to that address as a POST, carrying the original
`X-Webhook-Signature` and `X-Webhook-Timestamp` headers — the body arrives byte
for byte as it was signed, so your usual signature check works unchanged.

Each delivery is reported with its event type, the status your endpoint returned
and how long it took:

```
ok  DOCUMENT_SIGNED  ->  200  (48 ms)
```

Use `--skip-verify` to drop the signature headers when you want to exercise a
handler that has no key configured yet.

## Signing out

```bash
autosignly logout
```

Removes the stored credentials for the current API address.

## License

Apache-2.0
