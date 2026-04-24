#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, executeTool } from "./lib/meta-tools";

const server = new Server(
  { name: "houston", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const r = await executeTool(name, (args ?? {}) as Record<string, unknown>);
  return {
    content: [{ type: "text", text: r.content }],
    isError: r.isError,
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
