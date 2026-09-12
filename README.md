# Autosignly SDK

Open-source client libraries for the [Autosignly](https://autosignly.eu) API - eIDAS electronic
signatures and document workflows, callable from your own code.

> **Status: stable.** The clients are released and ready for production use. The current line is
> `1.0.*`, published to Maven Central, npm and PyPI; the newest release of each package is listed
> under [tags](https://github.com/16it-pl/autosignly-sdk/tags).

## What lives here

- **Client libraries** for the Autosignly public API, in Java, Node.js and Python. Each one covers
  the whole API and ships with usage examples in its README.
- **A command-line tool** for local development, including forwarding webhooks to `localhost`
  without a tunnel.
- **The API specification** every client is checked against by its contract tests, so no language
  drifts away from the API.

Everything in this repository is Apache-2.0 licensed. Use it, fork it, ship it.

## Why Autosignly

**eIDAS signatures from 0.30 PLN (about EUR 0.07) per signature.** We believe that is the lowest
price on the market.

**Pay as you go.** No subscription, no monthly minimum, no per-seat licence. You pay for the
signatures you actually use.

**Built for developers.** A REST API with API keys, sandbox environments separate from production,
and webhooks for everything that happens asynchronously.

## AI friendly

Autosignly is designed to be driven by AI agents as well as by code. We ship an
[MCP](https://modelcontextprotocol.io) server, so assistants can list templates, generate documents
and send them for signature on your behalf:

- **Claude** - add the Autosignly connector and ask it to prepare and send a document
- **ChatGPT** - the same connector works through MCP

The same operations are available through the API and the SDKs, so an agent-driven flow and a
code-driven flow do exactly the same thing.

## Links

- Website: <https://autosignly.eu>
- API documentation: <https://docs.16it.eu/docs/intro/>
- Issues and questions: [GitHub issues](https://github.com/16it-pl/autosignly-sdk/issues)

## License

[Apache License 2.0](LICENSE)
