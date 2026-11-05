# Glassbox MCP

Stdio MCP server. One tool, `check_agent`. It wraps the core auditor and returns JSON:

- `overall` — the highest rung already on the ladder (`RISKY`, then `NOT_PROVEN`, then `PROVEN`)
- `summary` — one plain-English sentence
- `report` — the same ladder the CLI prints

It does not send transactions, and it does not judge payments. Payments are Gideon: https://github.com/Adelekejr/Gideon-near. It does not take a collateral URL. A NEAR account id is checked before any chain read. About six calls a minute are accepted in one process.

The npm package is not published. Publishing it is not part of this submission. Do not publish it. The bin is `glassbox-mcp`, started with `node` from this checkout.

## Do run it from this repo

See `node packages/mcp/bin/glassbox-mcp.js` from the repo root. The process speaks MCP on stdin/stdout. Do not print logs on stdout.

## Do install it for Claude Desktop

The package name is `glassbox-mcp`. It is not on npm yet, so point at this checkout. In Claude Desktop → Settings → Developer → Edit Config:

```json
{
  "mcpServers": {
    "glassbox": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/Glassbox/packages/mcp/bin/glassbox-mcp.js"]
    }
  }
}
```

`tsx` is a dependency of `glassbox-mcp`, so the bin can start the TypeScript entry after `pnpm install` at the repo root.

## Do install it for Cursor

Cursor → Settings → MCP, or `.cursor/mcp.json` in the project. A local checkout:

```json
{
  "mcpServers": {
    "glassbox": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/Glassbox/packages/mcp/bin/glassbox-mcp.js"]
    }
  }
}
```

## Do call the tool

`target` is a NEAR account (`ac-sandbox.votron.testnet`) or pasted JSON. Local file paths are not accepted, including `../` and symlinks. Optional `network` is `testnet` or `mainnet`. A `.testnet` or `.near` suffix selects the network when `network` is omitted. A URL is refused.

The SDK is `@modelcontextprotocol/sdk` 1.32.2 (MIT). `tsx` is MIT and is a dependency so the bin can run from this checkout. There is no npm publish in this submission.
