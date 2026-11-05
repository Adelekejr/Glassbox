import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CHECK_AGENT_DESCRIPTION, CHECK_AGENT_TARGET_DESCRIPTION, checkAgent } from "./check.js";

const server = new McpServer({
  name: "glassbox",
  version: "0.2.0",
});

server.registerTool(
  "check_agent",
  {
    title: "Check a NEAR agent",
    description: CHECK_AGENT_DESCRIPTION,
    inputSchema: {
      target: z.string().min(1).max(2_000_000).describe(CHECK_AGENT_TARGET_DESCRIPTION),
      network: z.enum(["testnet", "mainnet"]).optional().describe("testnet or mainnet."),
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
