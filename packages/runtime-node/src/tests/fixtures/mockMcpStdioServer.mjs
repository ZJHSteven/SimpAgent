/**
 * 本文件作用：
 * - 提供给 catalog bridge 测试使用的最小 MCP stdio server。
 * - 只暴露一个简单工具，便于验证 `tools/list` 与 `tools/call`。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "mock-stdio-mcp",
  version: "1.0.0"
});

server.registerTool(
  "echo_payload",
  {
    description: "把输入参数和传输类型原样返回，便于测试映射与调用。",
    inputSchema: {
      message: z.string().describe("要回显的文本"),
      count: z.number().int().describe("重复次数")
    }
  },
  async ({ message, count }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          transport: "stdio",
          message,
          count,
          echoed: `${message}:${count}`
        })
      }
    ],
    structuredContent: {
      transport: "stdio",
      message,
      count,
      echoed: `${message}:${count}`
    }
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
