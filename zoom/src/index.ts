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

interface ZoomRecording {
  uuid: string;
  id: number;
  account_id: string;
  host_id: string;
  host_email: string;
  topic: string;
  type: number;
  start_time: string;
  duration: number;
  share_url: string;
  total_size: number;
  recording_count: number;
  participant_audio_files?: any[];
  recording_files: ZoomRecordingFile[];
}

interface ZoomRecordingFile {
  id: string;
  meeting_id: string;
  recording_start: string;
  recording_end: string;
  file_type: string;
  file_extension: string;
  file_size: number;
  play_url: string;
  download_url: string;
  status: string;
  recording_type: string;
}

interface ZoomMeetingSummary {
  summary: string;
  next_steps?: string[];
  key_points?: string[];
  action_items?: string[];
  agenda?: string[];
  meeting_id: string;
  meeting_topic: string;
  start_time: string;
  duration: number;
  host_email: string;
}

class ZoomMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "zoom-mcp-server",
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

  private async getZoomToken(): Promise<{ accountId: string; token: string }> {
    try {
      // Get Account ID
      const { stdout: accountIdStdout } = await execAsync(
        `op item get "Zoom API Credentials" --field "Account ID" --reveal 2>/dev/null`,
        {
          shell: '/bin/bash',
          env: {
            ...process.env,
            PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin',
          }
        }
      );

      // Get JWT Token  
      const { stdout: tokenStdout } = await execAsync(
        `op item get "Zoom API Credentials" --field "JWT Token" --reveal 2>/dev/null`,
        {
          shell: '/bin/bash',
          env: {
            ...process.env,
            PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin',
          }
        }
      );
      
      const accountId = accountIdStdout.trim();
      const token = tokenStdout.trim();
      
      if (!accountId || !token) {
        throw new Error("No credentials retrieved from 1Password");
      }
      
      return { accountId, token };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to retrieve Zoom API credentials from 1Password: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async makeZoomAPICall(endpoint: string, params: Record<string, any> = {}): Promise<any> {
    try {
      const { token } = await this.getZoomToken();
      
      const url = new URL(`https://api.zoom.us/v2/${endpoint}`);
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
      
      if (response.code && response.code !== 200) {
        throw new Error(`Zoom API error: ${response.message || 'Unknown error'}`);
      }

      return response;
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Zoom API call failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async downloadFile(url: string): Promise<string> {
    try {
      const { token } = await this.getZoomToken();
      
      const { stdout } = await execAsync(
        `curl -s -H "Authorization: Bearer ${token}" "${url}"`,
        {
          shell: '/bin/bash',
          env: {
            ...process.env,
            PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin',
          }
        }
      );

      return stdout;
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to download file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private formatMeetingSummary(summary: ZoomMeetingSummary): string {
    const startTime = new Date(summary.start_time).toLocaleString();
    const durationMinutes = Math.round(summary.duration / 60);
    
    let formatted = `📅 Meeting: ${summary.meeting_topic}\n`;
    formatted += `🕐 Date: ${startTime}\n`;
    formatted += `⏱️ Duration: ${durationMinutes} minutes\n`;
    formatted += `👤 Host: ${summary.host_email}\n`;
    formatted += `🆔 Meeting ID: ${summary.meeting_id}\n\n`;
    
    if (summary.summary) {
      formatted += `📝 Summary:\n${summary.summary}\n\n`;
    }
    
    if (summary.key_points && summary.key_points.length > 0) {
      formatted += `🔑 Key Points:\n`;
      summary.key_points.forEach(point => {
        formatted += `• ${point}\n`;
      });
      formatted += `\n`;
    }
    
    if (summary.action_items && summary.action_items.length > 0) {
      formatted += `✅ Action Items:\n`;
      summary.action_items.forEach(item => {
        formatted += `• ${item}\n`;
      });
      formatted += `\n`;
    }
    
    if (summary.next_steps && summary.next_steps.length > 0) {
      formatted += `➡️ Next Steps:\n`;
      summary.next_steps.forEach(step => {
        formatted += `• ${step}\n`;
      });
      formatted += `\n`;
    }
    
    if (summary.agenda && summary.agenda.length > 0) {
      formatted += `📋 Agenda:\n`;
      summary.agenda.forEach(item => {
        formatted += `• ${item}\n`;
      });
    }
    
    return formatted.trim();
  }

  private formatMeetingInfo(recording: ZoomRecording): string {
    const startTime = new Date(recording.start_time).toLocaleString();
    const durationMinutes = Math.round(recording.duration / 60);
    const sizeGB = (recording.total_size / (1024 * 1024 * 1024)).toFixed(2);
    
    let formatted = `📅 ${recording.topic}\n`;
    formatted += `🕐 ${startTime} (${durationMinutes} min)\n`;
    formatted += `👤 ${recording.host_email}\n`;
    formatted += `💾 ${sizeGB} GB • ${recording.recording_count} files\n`;
    formatted += `🆔 ${recording.id}\n`;
    
    return formatted;
  }

  private parseZoomSummaryContent(content: string): ZoomMeetingSummary | null {
    try {
      // Try to parse as JSON first (newer format)
      const parsed = JSON.parse(content);
      
      // Extract relevant fields from the JSON structure
      return {
        summary: parsed.summary || parsed.meeting_summary || '',
        key_points: parsed.key_points || parsed.keyPoints || [],
        action_items: parsed.action_items || parsed.actionItems || [],
        next_steps: parsed.next_steps || parsed.nextSteps || [],
        agenda: parsed.agenda || [],
        meeting_id: parsed.meeting_id || '',
        meeting_topic: parsed.topic || '',
        start_time: parsed.start_time || '',
        duration: parsed.duration || 0,
        host_email: parsed.host_email || ''
      };
    } catch (error) {
      // If JSON parsing fails, return null
      return null;
    }
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "zoom_search_meeting_summaries",
            description: "Search through AI Companion meeting summaries by topic, keywords, or date range",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query for meeting topics, content, or keywords",
                },
                user_id: {
                  type: "string",
                  description: "User ID or email to search recordings for (defaults to 'me')",
                  default: "me",
                },
                from: {
                  type: "string",
                  description: "Start date for search (YYYY-MM-DD format)",
                },
                to: {
                  type: "string",
                  description: "End date for search (YYYY-MM-DD format)", 
                },
                page_size: {
                  type: "number",
                  description: "Number of results per page (default: 30, max: 300)",
                  default: 30,
                },
              },
              required: ["query"],
            },
          },
          {
            name: "zoom_get_meeting_summary",
            description: "Get the AI Companion summary for a specific meeting by meeting ID",
            inputSchema: {
              type: "object",
              properties: {
                meeting_id: {
                  type: "string",
                  description: "The Zoom meeting ID to get the summary for",
                },
                user_id: {
                  type: "string",
                  description: "User ID or email (defaults to 'me')",
                  default: "me",
                },
              },
              required: ["meeting_id"],
            },
          },
          {
            name: "zoom_list_recent_meetings",
            description: "List recent meetings with AI summaries available",
            inputSchema: {
              type: "object",
              properties: {
                user_id: {
                  type: "string",
                  description: "User ID or email (defaults to 'me')",
                  default: "me",
                },
                from: {
                  type: "string",
                  description: "Start date (YYYY-MM-DD format)",
                },
                to: {
                  type: "string",
                  description: "End date (YYYY-MM-DD format)",
                },
                page_size: {
                  type: "number",
                  description: "Number of results (default: 30, max: 300)",
                  default: 30,
                },
              },
            },
          },
          {
            name: "zoom_get_user_info", 
            description: "Get information about a Zoom user",
            inputSchema: {
              type: "object",
              properties: {
                user_id: {
                  type: "string",
                  description: "User ID or email (defaults to 'me')",
                  default: "me",
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
          case "zoom_search_meeting_summaries": {
            const { 
              query, 
              user_id = "me", 
              from, 
              to, 
              page_size = 30 
            } = args as {
              query: string;
              user_id?: string;
              from?: string;
              to?: string;
              page_size?: number;
            };

            const params: any = {
              page_size: Math.min(page_size, 300),
            };
            
            if (from) params.from = from;
            if (to) params.to = to;

            // Get recordings for the user
            const response = await this.makeZoomAPICall(`users/${user_id}/recordings`, params);
            const meetings = response.meetings || [];

            // Search through meetings and their summaries
            const matchingMeetings: Array<{ meeting: ZoomRecording; summary?: ZoomMeetingSummary }> = [];
            const queryLower = query.toLowerCase();

            for (const meeting of meetings) {
              let matchesQuery = false;
              let summary: ZoomMeetingSummary | undefined;

              // Check if meeting topic matches
              if (meeting.topic.toLowerCase().includes(queryLower)) {
                matchesQuery = true;
              }

              // Look for summary files
              const summaryFile = meeting.recording_files?.find(
                (file: ZoomRecordingFile) => file.file_type === 'SUMMARY'
              );

              if (summaryFile) {
                try {
                  const summaryContent = await this.downloadFile(summaryFile.download_url);
                  const parsedSummary = this.parseZoomSummaryContent(summaryContent);
                  
                  if (parsedSummary) {
                    // Populate missing fields from meeting data
                    summary = {
                      ...parsedSummary,
                      meeting_id: meeting.id.toString(),
                      meeting_topic: meeting.topic,
                      start_time: meeting.start_time,
                      duration: meeting.duration,
                      host_email: meeting.host_email,
                    };

                    // Check if summary content matches query
                    const summaryText = [
                      summary.summary,
                      ...(summary.key_points || []),
                      ...(summary.action_items || []),
                      ...(summary.next_steps || []),
                      ...(summary.agenda || [])
                    ].join(' ').toLowerCase();

                    if (summaryText.includes(queryLower)) {
                      matchesQuery = true;
                    }
                  }
                } catch (error) {
                  // Continue if we can't download/parse summary
                  console.error(`Failed to process summary for meeting ${meeting.id}:`, error);
                }
              }

              if (matchesQuery) {
                matchingMeetings.push({ meeting, summary });
              }
            }

            if (matchingMeetings.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: `No meetings found matching query: "${query}"`,
                  },
                ],
              };
            }

            // Format results
            const results = matchingMeetings.map(({ meeting, summary }) => {
              let result = this.formatMeetingInfo(meeting);
              
              if (summary) {
                result += `\n\n${this.formatMeetingSummary(summary)}`;
              } else {
                result += `\n\n⚠️ No AI summary available for this meeting`;
              }
              
              return result;
            });

            return {
              content: [
                {
                  type: "text",
                  text: `Search Results for "${query}" (${matchingMeetings.length} meetings found):\n\n${results.join('\n\n---\n\n')}`,
                },
              ],
            };
          }

          case "zoom_get_meeting_summary": {
            const { meeting_id, user_id = "me" } = args as {
              meeting_id: string;
              user_id?: string;
            };

            // Get recordings for the user
            const response = await this.makeZoomAPICall(`users/${user_id}/recordings`);
            const meetings = response.meetings || [];

            // Find the specific meeting
            const meeting = meetings.find((m: ZoomRecording) => 
              m.id.toString() === meeting_id || m.uuid === meeting_id
            );

            if (!meeting) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Meeting ${meeting_id} not found`
              );
            }

            // Look for summary file
            const summaryFile = meeting.recording_files?.find(
              (file: ZoomRecordingFile) => file.file_type === 'SUMMARY'
            );

            if (!summaryFile) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Meeting found but no AI summary available:\n\n${this.formatMeetingInfo(meeting)}`,
                  },
                ],
              };
            }

            // Download and parse summary
            const summaryContent = await this.downloadFile(summaryFile.download_url);
            const parsedSummary = this.parseZoomSummaryContent(summaryContent);

            if (!parsedSummary) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Meeting found but summary format not recognized:\n\n${this.formatMeetingInfo(meeting)}`,
                  },
                ],
              };
            }

            // Populate missing fields
            const summary: ZoomMeetingSummary = {
              ...parsedSummary,
              meeting_id: meeting.id.toString(),
              meeting_topic: meeting.topic,
              start_time: meeting.start_time,
              duration: meeting.duration,
              host_email: meeting.host_email,
            };

            return {
              content: [
                {
                  type: "text",
                  text: this.formatMeetingSummary(summary),
                },
              ],
            };
          }

          case "zoom_list_recent_meetings": {
            const { 
              user_id = "me", 
              from, 
              to, 
              page_size = 30 
            } = args as {
              user_id?: string;
              from?: string;
              to?: string;
              page_size?: number;
            };

            const params: any = {
              page_size: Math.min(page_size, 300),
            };
            
            if (from) params.from = from;
            if (to) params.to = to;

            const response = await this.makeZoomAPICall(`users/${user_id}/recordings`, params);
            const meetings = response.meetings || [];

            // Filter meetings that have AI summaries
            const meetingsWithSummaries = meetings.filter((meeting: ZoomRecording) =>
              meeting.recording_files?.some((file: ZoomRecordingFile) => file.file_type === 'SUMMARY')
            );

            if (meetingsWithSummaries.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: "No recent meetings with AI summaries found.",
                  },
                ],
              };
            }

            const meetingList = meetingsWithSummaries.map((meeting: ZoomRecording) => 
              this.formatMeetingInfo(meeting)
            );

            return {
              content: [
                {
                  type: "text",
                  text: `Recent Meetings with AI Summaries (${meetingsWithSummaries.length} found):\n\n${meetingList.join('\n\n---\n\n')}`,
                },
              ],
            };
          }

          case "zoom_get_user_info": {
            const { user_id = "me" } = args as { user_id?: string };

            const response = await this.makeZoomAPICall(`users/${user_id}`);
            const user = response;

            const info = [
              `Name: ${user.first_name} ${user.last_name}`,
              `Email: ${user.email}`,
              `User ID: ${user.id}`,
              `Type: ${user.type === 1 ? 'Basic' : user.type === 2 ? 'Licensed' : user.type === 3 ? 'On-prem' : 'Unknown'}`,
              `Status: ${user.status}`,
              `Department: ${user.dept || 'Not specified'}`,
              `Timezone: ${user.timezone || 'Not specified'}`,
              `Last Login: ${user.last_login_time ? new Date(user.last_login_time).toLocaleString() : 'Never'}`,
              `Created: ${user.created_at ? new Date(user.created_at).toLocaleString() : 'Unknown'}`,
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
    console.error("Zoom MCP server running on stdio");
  }
}

const server = new ZoomMCPServer();
server.run().catch(console.error); 