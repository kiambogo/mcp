#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

class ConfluenceMCPServer {
  private server: Server;
  private confluenceBaseUrl: string = '';
  private email: string = '';
  private apiToken: string = '';

  constructor() {
    this.server = new Server(
      {
        name: "confluence-mcp-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  private async getCredentials(): Promise<void> {
    try {
      // Get credentials from 1Password
      const getTokenCommand = `
        if op account list >/dev/null 2>&1; then
          echo "Using existing 1Password session" >&2
          api_token=$(op item get "Confluence API Key" --field password --reveal 2>/dev/null)
          email=$(op item get "Confluence API Key" --field username --reveal 2>/dev/null)
          base_url=$(op item get "Confluence API Key" --field "base url" --reveal 2>/dev/null)
          
          echo "$email"
          echo "$api_token"  
          echo "$base_url"
        else
          echo "ERROR: 1Password CLI not available or not signed in" >&2
          exit 1
        fi
      `;

      const { stdout, stderr } = await execAsync(getTokenCommand, {
        shell: '/bin/bash',
        env: {
          ...process.env,
          PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin',
        }
      });

      if (stderr && !stderr.includes('Using')) {
        console.error("Credential retrieval stderr:", stderr);
      }

      const lines = stdout.trim().split('\n');
      if (lines.length >= 3 && lines[0] && lines[1] && lines[2]) {
        this.email = lines[0];
        this.apiToken = lines[1];
        this.confluenceBaseUrl = lines[2];
      } else {
        throw new Error("Failed to retrieve all required credentials from 1Password");
      }
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to retrieve credentials: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async makeConfluenceRequest(endpoint: string, params?: Record<string, string>): Promise<any> {
    await this.getCredentials();
    
    const url = new URL(`${this.confluenceBaseUrl}/wiki/api/v2/${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value) url.searchParams.append(key, value);
      });
    }

    const auth = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');
    
    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Confluence API request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "confluence_search_pages",
            description: "Search for Confluence pages using text search or CQL",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query text to find pages",
                },
                space: {
                  type: "string", 
                  description: "Space key to limit search to specific space (optional)",
                },
                limit: {
                  type: "number",
                  description: "Maximum number of results to return (default: 20)",
                  default: 20,
                },
              },
              required: ["query"],
            },
          },
          {
            name: "confluence_get_page",
            description: "Get detailed content of a specific Confluence page",
            inputSchema: {
              type: "object",
              properties: {
                page_id: {
                  type: "string",
                  description: "The Confluence page ID",
                },
                body_format: {
                  type: "string",
                  description: "Format for page body content (storage, atlas_doc_format, view)",
                  default: "storage",
                },
              },
              required: ["page_id"],
            },
          },
          {
            name: "confluence_list_spaces",
            description: "List all accessible Confluence spaces",
            inputSchema: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  description: "Space type filter (global, personal)",
                },
                status: {
                  type: "string",
                  description: "Space status filter (current, archived)",
                  default: "current",
                },
                limit: {
                  type: "number",
                  description: "Maximum number of spaces to return (default: 25)",
                  default: 25,
                },
              },
            },
          },
          {
            name: "confluence_get_space",
            description: "Get detailed information about a specific Confluence space",
            inputSchema: {
              type: "object",
              properties: {
                space_id: {
                  type: "string",
                  description: "The Confluence space ID",
                },
              },
              required: ["space_id"],
            },
          },
          {
            name: "confluence_list_pages",
            description: "List pages in a specific space or all accessible pages",
            inputSchema: {
              type: "object",
              properties: {
                space_id: {
                  type: "string",
                  description: "Space ID to list pages from (optional - if not provided, lists all accessible pages)",
                },
                limit: {
                  type: "number",
                  description: "Maximum number of pages to return (default: 25)",
                  default: 25,
                },
                status: {
                  type: "string",
                  description: "Page status filter (current, trashed, draft)",
                  default: "current",
                },
              },
            },
          },
          {
            name: "confluence_get_page_children",
            description: "Get child pages of a specific Confluence page",
            inputSchema: {
              type: "object",
              properties: {
                page_id: {
                  type: "string",
                  description: "The parent page ID",
                },
                limit: {
                  type: "number",
                  description: "Maximum number of child pages to return (default: 25)",
                  default: 25,
                },
              },
              required: ["page_id"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "confluence_search_pages": {
            const { query, space, limit = 20 } = args as {
              query: string;
              space?: string;
              limit?: number;
            };

            const params: Record<string, string> = {
              limit: limit.toString(),
            };

            // Use CQL query format for better search
            let cql = `type=page AND text~"${query}"`;
            if (space) {
              cql += ` AND space.key="${space}"`;
            }
            params.cql = cql;

            const result = await this.makeConfluenceRequest('pages', params);

            const formattedResults = result.results?.map((page: any) => 
              `• ${page.title} (ID: ${page.id})\n  Space: ${page.spaceId}\n  URL: ${this.confluenceBaseUrl}/wiki${page._links?.webuiObsoleteUrlPrefix || ''}/pages/${page.id}`
            ).join('\n\n') || 'No pages found';

            return {
              content: [
                {
                  type: "text",
                  text: `Search Results for "${query}":\n\n${formattedResults}`,
                },
              ],
            };
          }

          case "confluence_get_page": {
            const { page_id, body_format = "storage" } = args as {
              page_id: string;
              body_format?: string;
            };

            const params: Record<string, string> = {
              'body-format': body_format,
            };

            const result = await this.makeConfluenceRequest(`pages/${page_id}`, params);

            const pageInfo = `Title: ${result.title}
ID: ${result.id}
Space: ${result.spaceId}
Status: ${result.status}
Created: ${result.createdAt}
Last Modified: ${result.version?.createdAt}
Version: ${result.version?.number}

Content:
${result.body?.[body_format]?.value || 'No content available'}`;

            return {
              content: [
                {
                  type: "text",
                  text: pageInfo,
                },
              ],
            };
          }

          case "confluence_list_spaces": {
            const { type, status = "current", limit = 25 } = args as {
              type?: string;
              status?: string;
              limit?: number;
            };

            const params: Record<string, string> = {
              limit: limit.toString(),
              status,
            };

            if (type) {
              params.type = type;
            }

            const result = await this.makeConfluenceRequest('spaces', params);

            const formattedSpaces = result.results?.map((space: any) => 
              `• ${space.name} (${space.key})\n  ID: ${space.id}\n  Type: ${space.type}\n  Description: ${space.description?.plain?.value || 'No description'}`
            ).join('\n\n') || 'No spaces found';

            return {
              content: [
                {
                  type: "text",
                  text: `Confluence Spaces:\n\n${formattedSpaces}`,
                },
              ],
            };
          }

          case "confluence_get_space": {
            const { space_id } = args as {
              space_id: string;
            };

            const result = await this.makeConfluenceRequest(`spaces/${space_id}`);

            const spaceInfo = `Name: ${result.name}
Key: ${result.key}
ID: ${result.id}
Type: ${result.type}
Status: ${result.status}
Created: ${result.createdAt}
Homepage ID: ${result.homepageId}
Description: ${result.description?.plain?.value || 'No description'}`;

            return {
              content: [
                {
                  type: "text",
                  text: `Space Information:\n\n${spaceInfo}`,
                },
              ],
            };
          }

          case "confluence_list_pages": {
            const { space_id, limit = 25, status = "current" } = args as {
              space_id?: string;
              limit?: number;
              status?: string;
            };

            const params: Record<string, string> = {
              limit: limit.toString(),
              status,
            };

            if (space_id) {
              params['space-id'] = space_id;
            }

            const result = await this.makeConfluenceRequest('pages', params);

            const formattedPages = result.results?.map((page: any) => 
              `• ${page.title} (ID: ${page.id})\n  Space: ${page.spaceId}\n  Status: ${page.status}\n  Created: ${page.createdAt}`
            ).join('\n\n') || 'No pages found';

            return {
              content: [
                {
                  type: "text",
                  text: `Pages${space_id ? ` in Space ${space_id}` : ''}:\n\n${formattedPages}`,
                },
              ],
            };
          }

          case "confluence_get_page_children": {
            const { page_id, limit = 25 } = args as {
              page_id: string;
              limit?: number;
            };

            const params: Record<string, string> = {
              limit: limit.toString(),
            };

            const result = await this.makeConfluenceRequest(`pages/${page_id}/children`, params);

            const formattedChildren = result.results?.map((page: any) => 
              `• ${page.title} (ID: ${page.id})\n  Status: ${page.status}\n  Created: ${page.createdAt}`
            ).join('\n\n') || 'No child pages found';

            return {
              content: [
                {
                  type: "text",
                  text: `Child Pages of ${page_id}:\n\n${formattedChildren}`,
                },
              ],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }

        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Confluence MCP server running on stdio");
  }
}

const server = new ConfluenceMCPServer();
server.run().catch(console.error); 