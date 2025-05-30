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

class SlackMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "slack-mcp-server",
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

  private async getSlackToken(): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `op item get "Slack API Token" --field password --reveal 2>/dev/null`,
        {
          shell: '/bin/bash',
          env: {
            ...process.env,
            PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin',
          }
        }
      );
      
      const token = stdout.trim();
      if (!token) {
        throw new Error("No token retrieved from 1Password");
      }
      
      return token;
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to retrieve Slack API token from 1Password: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async makeSlackAPICall(endpoint: string, params: Record<string, any> = {}): Promise<any> {
    try {
      const token = await this.getSlackToken();
      
      const url = new URL(`https://slack.com/api/${endpoint}`);
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });

      const { stdout } = await execAsync(
        `curl -s -H "Authorization: Bearer ${token}" "${url.toString()}"`,
        {
          shell: '/bin/bash',
          env: {
            ...process.env,
            PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin',
          }
        }
      );

      const response = JSON.parse(stdout);
      
      if (!response.ok) {
        throw new Error(`Slack API error: ${response.error || 'Unknown error'}`);
      }

      return response;
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Slack API call failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private formatMessage(message: any, channelName?: string): string {
    const timestamp = new Date(parseFloat(message.ts) * 1000).toISOString();
    const user = message.user || message.username || 'Unknown User';
    const channel = channelName ? `#${channelName}` : '';
    
    let text = message.text || '';
    
    // Handle message attachments and files
    if (message.attachments && message.attachments.length > 0) {
      text += '\n[Attachments: ' + message.attachments.map((att: any) => att.title || att.fallback || 'Attachment').join(', ') + ']';
    }
    
    if (message.files && message.files.length > 0) {
      text += '\n[Files: ' + message.files.map((file: any) => file.name).join(', ') + ']';
    }

    return `[${timestamp}] ${user}${channel ? ` in ${channel}` : ''}: ${text}`;
  }

  private parseSlackLink(link: string): { channel?: string; ts?: string } | null {
    // Parse Slack permalinks like https://workspace.slack.com/archives/C1234567890/p1234567890123456
    const permalinkMatch = link.match(/\/archives\/([^\/]+)\/p(\d+)/);
    if (permalinkMatch) {
      const [, channelId, ts] = permalinkMatch;
      if (!channelId || !ts) {
        return null;
      }
      // Convert timestamp from permalink format to Slack API format
      const timestamp = ts.slice(0, 10) + '.' + ts.slice(10);
      return { channel: channelId, ts: timestamp };
    }
    
    // Parse channel links like https://workspace.slack.com/archives/C1234567890
    const channelMatch = link.match(/\/archives\/([^\/\?]+)/);
    if (channelMatch) {
      const [, channelId] = channelMatch;
      if (!channelId) {
        return null;
      }
      return { channel: channelId };
    }
    
    return null;
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "slack_search_messages",
            description: "Search for messages across the Slack workspace using Slack's search syntax",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query using Slack search syntax (e.g., 'from:@user in:#channel after:2024-01-01')",
                },
                sort: {
                  type: "string",
                  description: "Sort order: 'timestamp' (default) or 'score'",
                  default: "timestamp",
                },
                count: {
                  type: "number",
                  description: "Number of results to return (default: 20, max: 100)",
                  default: 20,
                },
              },
              required: ["query"],
            },
          },
          {
            name: "slack_get_channel_messages",
            description: "Get recent messages from a specific channel",
            inputSchema: {
              type: "object",
              properties: {
                channel: {
                  type: "string",
                  description: "Channel ID or name (with # prefix for public channels)",
                },
                limit: {
                  type: "number",
                  description: "Number of messages to retrieve (default: 50, max: 1000)",
                  default: 50,
                },
                oldest: {
                  type: "string",
                  description: "Start of time range (Unix timestamp or ISO date)",
                },
                latest: {
                  type: "string",
                  description: "End of time range (Unix timestamp or ISO date)",
                },
              },
              required: ["channel"],
            },
          },
          {
            name: "slack_get_thread_messages",
            description: "Get all messages in a specific thread",
            inputSchema: {
              type: "object",
              properties: {
                channel: {
                  type: "string",
                  description: "Channel ID where the thread exists",
                },
                thread_ts: {
                  type: "string",
                  description: "Timestamp of the thread parent message",
                },
              },
              required: ["channel", "thread_ts"],
            },
          },
          {
            name: "slack_read_permalink",
            description: "Read a specific message from a Slack permalink URL",
            inputSchema: {
              type: "object",
              properties: {
                permalink: {
                  type: "string",
                  description: "Slack permalink URL (e.g., https://workspace.slack.com/archives/C1234567890/p1234567890123456)",
                },
                include_thread: {
                  type: "boolean",
                  description: "Whether to include thread replies if the message is a thread parent",
                  default: false,
                },
              },
              required: ["permalink"],
            },
          },
          {
            name: "slack_get_channel_info",
            description: "Get information about a specific channel",
            inputSchema: {
              type: "object",
              properties: {
                channel: {
                  type: "string",
                  description: "Channel ID or name (with # prefix for public channels)",
                },
              },
              required: ["channel"],
            },
          },
          {
            name: "slack_get_user_info",
            description: "Get information about a specific user",
            inputSchema: {
              type: "object",
              properties: {
                user: {
                  type: "string",
                  description: "User ID or username (with @ prefix)",
                },
              },
              required: ["user"],
            },
          },
          {
            name: "slack_list_channels",
            description: "List channels that the bot has access to",
            inputSchema: {
              type: "object",
              properties: {
                types: {
                  type: "string",
                  description: "Comma-separated list of channel types (public_channel, private_channel, mpim, im)",
                  default: "public_channel,private_channel",
                },
                limit: {
                  type: "number",
                  description: "Number of channels to return (default: 100)",
                  default: 100,
                },
              },
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "slack_search_messages": {
            const { query, sort = "timestamp", count = 20 } = args as {
              query: string;
              sort?: string;
              count?: number;
            };

            const response = await this.makeSlackAPICall("search.messages", {
              query,
              sort,
              count: Math.min(count, 100),
            });

            const messages = response.messages?.matches || [];
            const formattedMessages = messages.map((message: any) => 
              this.formatMessage(message, message.channel?.name)
            );

            return {
              content: [
                {
                  type: "text",
                  text: `Search Results (${messages.length} messages found):\n\n${formattedMessages.join('\n\n')}`,
                },
              ],
            };
          }

          case "slack_get_channel_messages": {
            const { channel, limit = 50, oldest, latest } = args as {
              channel: string;
              limit?: number;
              oldest?: string;
              latest?: string;
            };

            // Convert channel name to ID if needed
            let channelId = channel;
            if (channel.startsWith('#')) {
              const channelsResponse = await this.makeSlackAPICall("conversations.list", {
                types: "public_channel,private_channel",
              });
              const channelObj = channelsResponse.channels?.find((c: any) => 
                c.name === channel.slice(1)
              );
              if (channelObj) {
                channelId = channelObj.id;
              }
            }

            const params: any = {
              channel: channelId,
              limit: Math.min(limit, 1000),
            };

            if (oldest) params.oldest = oldest;
            if (latest) params.latest = latest;

            const response = await this.makeSlackAPICall("conversations.history", params);
            
            // Get channel info for formatting
            const channelInfo = await this.makeSlackAPICall("conversations.info", { channel: channelId });
            const channelName = channelInfo.channel?.name;

            const messages = response.messages || [];
            const formattedMessages = messages.reverse().map((message: any) => 
              this.formatMessage(message, channelName)
            );

            return {
              content: [
                {
                  type: "text",
                  text: `Channel Messages from #${channelName} (${messages.length} messages):\n\n${formattedMessages.join('\n\n')}`,
                },
              ],
            };
          }

          case "slack_get_thread_messages": {
            const { channel, thread_ts } = args as {
              channel: string;
              thread_ts: string;
            };

            const response = await this.makeSlackAPICall("conversations.replies", {
              channel,
              ts: thread_ts,
            });

            // Get channel info for formatting
            const channelInfo = await this.makeSlackAPICall("conversations.info", { channel });
            const channelName = channelInfo.channel?.name;

            const messages = response.messages || [];
            const formattedMessages = messages.map((message: any, index: number) => {
              const prefix = index === 0 ? "[THREAD ROOT] " : "[REPLY] ";
              return prefix + this.formatMessage(message, channelName);
            });

            return {
              content: [
                {
                  type: "text",
                  text: `Thread Messages in #${channelName} (${messages.length} messages):\n\n${formattedMessages.join('\n\n')}`,
                },
              ],
            };
          }

          case "slack_read_permalink": {
            const { permalink, include_thread = false } = args as {
              permalink: string;
              include_thread?: boolean;
            };

            const parsed = this.parseSlackLink(permalink);
            if (!parsed?.channel || !parsed?.ts) {
              throw new McpError(
                ErrorCode.InvalidParams,
                "Invalid Slack permalink format"
              );
            }

            // Get the specific message
            const response = await this.makeSlackAPICall("conversations.history", {
              channel: parsed.channel,
              latest: parsed.ts,
              limit: 1,
              inclusive: true,
            });

            const message = response.messages?.[0];
            if (!message) {
              throw new McpError(
                ErrorCode.InvalidParams,
                "Message not found"
              );
            }

            // Get channel info for formatting
            const channelInfo = await this.makeSlackAPICall("conversations.info", { 
              channel: parsed.channel 
            });
            const channelName = channelInfo.channel?.name;

            let result = `Message from permalink:\n\n${this.formatMessage(message, channelName)}`;

            // Include thread if requested and message has replies
            if (include_thread && message.thread_ts) {
              const threadResponse = await this.makeSlackAPICall("conversations.replies", {
                channel: parsed.channel,
                ts: message.thread_ts,
              });

              const threadMessages = threadResponse.messages?.slice(1) || []; // Skip parent message
              if (threadMessages.length > 0) {
                const formattedThread = threadMessages.map((msg: any) => 
                  "[REPLY] " + this.formatMessage(msg, channelName)
                );
                result += `\n\n--- Thread Replies (${threadMessages.length}) ---\n\n${formattedThread.join('\n\n')}`;
              }
            }

            return {
              content: [
                {
                  type: "text",
                  text: result,
                },
              ],
            };
          }

          case "slack_get_channel_info": {
            const { channel } = args as { channel: string };

            // Convert channel name to ID if needed
            let channelId = channel;
            if (channel.startsWith('#')) {
              const channelsResponse = await this.makeSlackAPICall("conversations.list", {
                types: "public_channel,private_channel",
              });
              const channelObj = channelsResponse.channels?.find((c: any) => 
                c.name === channel.slice(1)
              );
              if (channelObj) {
                channelId = channelObj.id;
              }
            }

            const response = await this.makeSlackAPICall("conversations.info", {
              channel: channelId,
            });

            const channelInfo = response.channel;
            const info = [
              `Name: #${channelInfo.name}`,
              `ID: ${channelInfo.id}`,
              `Purpose: ${channelInfo.purpose?.value || 'No purpose set'}`,
              `Topic: ${channelInfo.topic?.value || 'No topic set'}`,
              `Type: ${channelInfo.is_private ? 'Private' : 'Public'} Channel`,
              `Members: ${channelInfo.num_members || 'Unknown'}`,
              `Created: ${new Date(channelInfo.created * 1000).toISOString()}`,
            ];

            return {
              content: [
                {
                  type: "text",
                  text: `Channel Information:\n\n${info.join('\n')}`,
                },
              ],
            };
          }

          case "slack_get_user_info": {
            const { user } = args as { user: string };

            // Remove @ prefix if present
            const userId = user.startsWith('@') ? user.slice(1) : user;

            const response = await this.makeSlackAPICall("users.info", {
              user: userId,
            });

            const userInfo = response.user;
            const info = [
              `Name: ${userInfo.real_name || userInfo.name}`,
              `Username: @${userInfo.name}`,
              `ID: ${userInfo.id}`,
              `Title: ${userInfo.profile?.title || 'No title set'}`,
              `Email: ${userInfo.profile?.email || 'Not available'}`,
              `Status: ${userInfo.presence || 'Unknown'}`,
              `Time Zone: ${userInfo.tz_label || 'Unknown'}`,
            ];

            return {
              content: [
                {
                  type: "text",
                  text: `User Information:\n\n${info.join('\n')}`,
                },
              ],
            };
          }

          case "slack_list_channels": {
            const { types = "public_channel,private_channel", limit = 100 } = args as {
              types?: string;
              limit?: number;
            };

            const response = await this.makeSlackAPICall("conversations.list", {
              types,
              limit: Math.min(limit, 1000),
            });

            const channels = response.channels || [];
            const channelList = channels.map((channel: any) => {
              const type = channel.is_private ? 'Private' : 'Public';
              const memberCount = channel.num_members ? ` (${channel.num_members} members)` : '';
              return `#${channel.name} - ${type}${memberCount}`;
            });

            return {
              content: [
                {
                  type: "text",
                  text: `Channels (${channels.length} found):\n\n${channelList.join('\n')}`,
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
    console.error("Slack MCP server running on stdio");
  }
}

const server = new SlackMCPServer();
server.run().catch(console.error); 