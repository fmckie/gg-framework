import { beforeEach, describe, expect, it, vi } from "vitest";
import { KLEIO_PRODUCT_PROFILE } from "@kleio/core";
import { MCPClientManager, resolveMcpClientName } from "./client.js";

const sdkMocks = vi.hoisted(() => ({
  clientConstructor: vi.fn(),
  connect: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  close: vi.fn(),
  streamableTransport: vi.fn(),
  sseTransport: vi.fn(),
  stdioTransport: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class ClientMock {
    constructor(clientInfo: unknown) {
      sdkMocks.clientConstructor(clientInfo);
    }

    connect = sdkMocks.connect;
    listTools = sdkMocks.listTools;
    callTool = sdkMocks.callTool;
    close = sdkMocks.close;
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class StreamableHTTPClientTransportMock {
    constructor(url: URL, options: unknown) {
      sdkMocks.streamableTransport(url, options);
    }
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class SSEClientTransportMock {
    constructor(url: URL, options: unknown) {
      sdkMocks.sseTransport(url, options);
    }
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class StdioClientTransportMock {
    stderr = undefined;

    constructor(options: unknown) {
      sdkMocks.stdioTransport(options);
    }
  },
}));

vi.mock("../logger.js", () => ({ log: vi.fn() }));

beforeEach(() => {
  for (const mock of Object.values(sdkMocks)) mock.mockReset();
  sdkMocks.connect.mockResolvedValue(undefined);
  sdkMocks.listTools.mockResolvedValue({ tools: [] });
  sdkMocks.close.mockResolvedValue(undefined);
});

describe("resolveMcpClientName", () => {
  it("uses the branded product-profile name by default", () => {
    expect(KLEIO_PRODUCT_PROFILE.coder.mcpClientName).toBe("kleio-coder");
    expect(resolveMcpClientName(undefined, {})).toBe(KLEIO_PRODUCT_PROFILE.coder.mcpClientName);
  });

  it("prefers the environment override over the default", () => {
    expect(
      resolveMcpClientName(undefined, {
        KLEIO_CODER_MCP_CLIENT_NAME: "environment-client",
      }),
    ).toBe("environment-client");
  });

  it("prefers an explicit name over the environment override", () => {
    expect(
      resolveMcpClientName("explicit-client", {
        KLEIO_CODER_MCP_CLIENT_NAME: "environment-client",
      }),
    ).toBe("explicit-client");
  });

  it("accepts the legacy client name explicitly or from the environment", () => {
    expect(KLEIO_PRODUCT_PROFILE.coder.legacyMcpClientName).toBe("ggcoder");
    expect(resolveMcpClientName("ggcoder", {})).toBe("ggcoder");
    expect(
      resolveMcpClientName(undefined, {
        KLEIO_CODER_MCP_CLIENT_NAME: "ggcoder",
      }),
    ).toBe("ggcoder");
  });
});

describe("MCPClientManager client identity wiring", () => {
  it("uses the default name for Streamable HTTP clients", async () => {
    const manager = new MCPClientManager({ environment: {} });

    const result = await manager.connectAllDetailed([
      { name: "remote", url: "https://example.com/mcp" },
    ]);

    expect(result).toEqual([{ name: "remote", ok: true, toolCount: 0, tools: [] }]);
    expect(sdkMocks.clientConstructor).toHaveBeenCalledWith({
      name: "kleio-coder",
      version: "1.0.0",
    });
  });

  it("uses an explicit legacy name for stdio clients even when the environment differs", async () => {
    const manager = new MCPClientManager({
      clientName: KLEIO_PRODUCT_PROFILE.coder.legacyMcpClientName,
      environment: { KLEIO_CODER_MCP_CLIENT_NAME: "environment-client" },
    });

    const result = await manager.connectAllDetailed([
      { name: "local", command: "node", args: ["server.js"] },
    ]);

    expect(result).toEqual([{ name: "local", ok: true, toolCount: 0, tools: [] }]);
    expect(sdkMocks.stdioTransport).toHaveBeenCalledOnce();
    expect(sdkMocks.clientConstructor).toHaveBeenCalledWith({
      name: "ggcoder",
      version: "1.0.0",
    });
  });

  it("uses an environment-provided legacy name for Streamable HTTP and SSE fallback clients", async () => {
    sdkMocks.connect
      .mockRejectedValueOnce(new Error("streamable unavailable"))
      .mockResolvedValueOnce(undefined);
    const manager = new MCPClientManager({
      environment: {
        KLEIO_CODER_MCP_CLIENT_NAME: KLEIO_PRODUCT_PROFILE.coder.legacyMcpClientName,
      },
    });

    const result = await manager.connectAllDetailed([
      { name: "remote", url: "https://example.com/mcp" },
    ]);

    expect(result).toEqual([{ name: "remote", ok: true, toolCount: 0, tools: [] }]);
    expect(sdkMocks.streamableTransport).toHaveBeenCalledOnce();
    expect(sdkMocks.sseTransport).toHaveBeenCalledOnce();
    expect(sdkMocks.clientConstructor).toHaveBeenCalledTimes(2);
    expect(sdkMocks.clientConstructor).toHaveBeenNthCalledWith(1, {
      name: "ggcoder",
      version: "1.0.0",
    });
    expect(sdkMocks.clientConstructor).toHaveBeenNthCalledWith(2, {
      name: "ggcoder",
      version: "1.0.0",
    });
  });
});
