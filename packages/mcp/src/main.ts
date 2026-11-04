import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { checkAgent } from "./check.js";

const server = new McpServer({
  name: "glassbox",
  version: "0.2.0",
});

server.registerTool(
  "check_agent",
  {
    title: "Check a NEAR agent",
    description:
      "Read-only Glassbox audit of a NEAR account or a pasted registration, app-compose, or deployment JSON. Returns the PROVEN / NOT PROVEN / RISKY ladder, a short summary, and the highest rung. Does not send transactions and does not judge payments.",
    inputSchema: {
      target: z
        .string()
        .describe("NEAR account id (ac-sandbox.votron.testnet) or a JSON document. A .testnet or .near suffix selects the network."),
      network: z.enum(["testnet", "mainnet"]).optional().describe("Override network detection."),
    },
  },
  async ({ target, network }) => {
    const result = await checkAgent({ target, network });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
