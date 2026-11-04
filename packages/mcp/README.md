# Glassbox MCP

Stdio MCP server. One tool, `check_agent`. It wraps the core auditor and returns JSON:

- `overall` — the highest rung already on the ladder (`RISKY`, then `NOT_PROVEN`, then `PROVEN`)
- `summary` — one plain-English sentence
- `report` — the same ladder the CLI prints

It does not sign, and it does not judge payments.

## Do run it from this repo

See `node packages/mcp/bin/glassbox-mcp.js` from the repo root. The process speaks MCP on stdin/stdout. Do not print logs on stdout.

## Do install it for Claude Desktop

The package name is `glassbox-mcp`. It is not on npm yet, so point at this checkout. In Claude Desktop → Settings → Developer → Edit Config:

```json
{
  "mcpServers": {
    "glassbox": {
      "command": "node",
      "args": ["--import", "tsx", "/ABSOLUTE/PATH/Glassbox/packages/mcp/src/main.ts"]
    }
  }
}
```

`tsx` must be resolvable (it is a devDependency of `packages/mcp` after `pnpm install` at the repo root). After the package is published, this is enough:

```json
{
  "mcpServers": {
    "glassbox": {
      "command": "npx",
      "args": ["-y", "glassbox-mcp"]
    }
  }
}
```

## Do install it for Cursor

Cursor → Settings → MCP, or `.cursor/mcp.json` in the project. Same command as Claude Desktop. A local checkout:

```json
{
  "mcpServers": {
    "glassbox": {
      "command": "node",
      "args": ["--import", "tsx", "/ABSOLUTE/PATH/Glassbox/packages/mcp/src/main.ts"]
    }
  }
}
```

Published form:

```json
{
  "mcpServers": {
    "glassbox": {
      "command": "npx",
      "args": ["-y", "glassbox-mcp"]
    }
  }
}
```

## Do call the tool

`target` is a NEAR account (`ac-sandbox.votron.testnet`) or pasted JSON. Optional `network` is `testnet` or `mainnet`. A `.testnet` or `.near` suffix selects the network when `network` is omitted.

The SDK is `@modelcontextprotocol/sdk` 1.32.2 (MIT).
