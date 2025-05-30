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

class JiraMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "jira-mcp-server",
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

  private async execJira(command: string): Promise<string> {
    try {
      // Try multiple approaches for authentication
      const authCommand = `
        if op account list >/dev/null 2>&1; then
          echo "Using existing 1Password session" >&2
          api_token=$(op item get "Jira API Key" --field password --reveal 2>/dev/null)
        fi

        if [ -z "$api_token" ]; then
          echo "ERROR: Failed to retrieve API token" >&2
          exit 1
        fi

        # Execute Jira command
        JIRA_API_TOKEN="$api_token" jira ${command}
      `;

      const { stdout, stderr } = await execAsync(authCommand, {
        shell: '/bin/bash',
        env: {
          ...process.env,
          PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin',
        }
      });

      if (stderr && !stderr.includes('Using')) {
        console.error("Command stderr:", stderr);
      }

      return stdout.trim();
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Jira command failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "jira_search_issues",
            description: "Search for Jira issues using JQL (Jira Query Language)",
            inputSchema: {
              type: "object",
              properties: {
                jql: {
                  type: "string",
                  description: "JQL query to search for issues (e.g., 'project = PROJ AND status = Open')",
                },
                limit: {
                  type: "number",
                  description: "Maximum number of results to return (default: 50)",
                  default: 50,
                },
                fields: {
                  type: "string",
                  description: "Comma-separated list of fields to return (default: key,summary,status,assignee)",
                  default: "key,summary,status,assignee",
                },
              },
              required: ["jql"],
            },
          },
          {
            name: "jira_get_issue",
            description: "Get detailed information about a specific Jira issue. A Jira issue will be provided (e.g., 'PROJ-123')",
            inputSchema: {
              type: "object",
              properties: {
                issue_key: {
                  type: "string",
                  description: "The Jira issue key (e.g., 'PROJ-123')",
                },
              },
              required: ["issue_key"],
            },
          },
          {
            name: "jira_create_issue",
            description: "Create a new Jira issue with all required fields including story points estimation.",
            inputSchema: {
              type: "object",
              properties: {
                project: {
                  type: "string",
                  description: "Project key where the issue will be created",
                },
                issue_type: {
                  type: "string",
                  description: "Type of issue (e.g., 'Bug', 'Task', 'Story')",
                },
                summary: {
                  type: "string",
                  description: "Brief summary/title of the issue",
                },
                description: {
                  type: "string",
                  description: "Detailed description of the issue (required)",
                },
                story_points: {
                  type: "number",
                  description: "Story points using fibonacci numbers (1, 2, 3, 5, 8, 13, 21) representing engineering days of effort",
                },
                labels: {
                  type: "string",
                  description: "Comma-separated list of labels (required)",
                },
                assignee: {
                  type: "string",
                  description: "Username or email of the assignee (optional, can be unassigned)",
                },
                priority: {
                  type: "string",
                  description: "Priority level (e.g., 'High', 'Medium', 'Low')",
                },
              },
              required: ["project", "issue_type", "summary", "description", "story_points", "labels"],
            },
          },
          {
            name: "jira_update_issue",
            description: "Update an existing Jira issue",
            inputSchema: {
              type: "object",
              properties: {
                issue_key: {
                  type: "string",
                  description: "The Jira issue key to update",
                },
                summary: {
                  type: "string",
                  description: "New summary/title for the issue",
                },
                description: {
                  type: "string",
                  description: "New description for the issue",
                },
                assignee: {
                  type: "string",
                  description: "New assignee username or email",
                },
                status: {
                  type: "string",
                  description: "New status (will attempt transition)",
                },
                priority: {
                  type: "string",
                  description: "New priority level",
                },
                labels: {
                  type: "string",
                  description: "Comma-separated list of labels to set",
                },
              },
              required: ["issue_key"],
            },
          },
          {
            name: "jira_add_comment",
            description: "Add a comment to a Jira issue",
            inputSchema: {
              type: "object",
              properties: {
                issue_key: {
                  type: "string",
                  description: "The Jira issue key to comment on",
                },
                comment: {
                  type: "string",
                  description: "The comment text to add",
                },
              },
              required: ["issue_key", "comment"],
            },
          },
          {
            name: "jira_transition_issue",
            description: "Transition a Jira issue to a different status",
            inputSchema: {
              type: "object",
              properties: {
                issue_key: {
                  type: "string",
                  description: "The Jira issue key to transition",
                },
                status: {
                  type: "string",
                  description: "Target status name (e.g., 'In Progress', 'Done')",
                },
              },
              required: ["issue_key", "status"],
            },
          },
          {
            name: "jira_list_projects",
            description: "List all accessible Jira projects",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "jira_search_issues": {
            const { jql, limit = 50, fields = "key,summary,status,assignee" } = args as {
              jql: string;
              limit?: number;
              fields?: string;
            };

            // Use correct command: issue list with JQL query
            const command = `issue list --jql "${jql}" --plain --columns "${fields}" --no-headers | head -${limit}`;
            const result = await this.execJira(command);

            return {
              content: [
                {
                  type: "text",
                  text: `Search Results:\n${result}`,
                },
              ],
            };
          }

          case "jira_get_issue": {
            const { issue_key } = args as { issue_key: string };

            // Use correct command: issue view
            const command = `issue view ${issue_key}`;
            const result = await this.execJira(command);

            return {
              content: [
                {
                  type: "text",
                  text: `Issue Details:\n${result}`,
                },
              ],
            };
          }

          case "jira_create_issue": {
            const { project, issue_type, summary, description, story_points, labels, assignee, priority } = args as {
              project: string;
              issue_type: string;
              summary: string;
              description: string;
              story_points: number;
              labels: string;
              assignee?: string;
              priority?: string;
            };

            // Validate story points are fibonacci numbers
            const fibonacciNumbers = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
            if (!fibonacciNumbers.includes(story_points)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Story points must be a fibonacci number: ${fibonacciNumbers.join(', ')}`
              );
            }

            // Use correct command: issue create with proper flags
            let command = `issue create --project "${project}" --type "${issue_type}" --summary "${summary}" --body "${description}" --no-input`;

            // Add story points (assuming the Jira CLI supports a story points field)
            command += ` --custom "Story Points=${story_points}"`;

            // Labels are now required, so always add them
            const labelList = labels.split(',');
            for (const label of labelList) {
              command += ` --label "${label.trim()}"`;
            }

            // Optional fields
            if (assignee) command += ` --assignee "${assignee}"`;
            if (priority) command += ` --priority "${priority}"`;

            const result = await this.execJira(command);

            return {
              content: [
                {
                  type: "text",
                  text: `Issue Created Successfully:\n${result}\n\nFields set:\n- Summary: ${summary}\n- Description: ${description}\n- Story Points: ${story_points}\n- Labels: ${labels}\n- Assignee: ${assignee || 'Unassigned'}\n- Priority: ${priority || 'Default'}`,
                },
              ],
            };
          }

          case "jira_update_issue": {
            const { issue_key, summary, description, assignee, status, priority, labels } = args as {
              issue_key: string;
              summary?: string;
              description?: string;
              assignee?: string;
              status?: string;
              priority?: string;
              labels?: string;
            };

            // Use correct command: issue edit
            let command = `issue edit ${issue_key} --no-input`;

            if (summary) command += ` --summary "${summary}"`;
            if (description) command += ` --body "${description}"`;
            if (assignee) command += ` --assignee "${assignee}"`;
            if (priority) command += ` --priority "${priority}"`;
            if (labels) {
              // Labels need to be added individually with -l flag
              const labelList = labels.split(',');
              for (const label of labelList) {
                command += ` --label "${label.trim()}"`;
              }
            }

            const result = await this.execJira(command);

            // If status transition was requested, do it separately using issue move
            if (status) {
              try {
                const transitionCommand = `issue move ${issue_key} "${status}"`;
                const transitionResult = await this.execJira(transitionCommand);
                return {
                  content: [
                    {
                      type: "text",
                      text: `Issue Updated:\n${result}\n\nStatus Transition:\n${transitionResult}`,
                    },
                  ],
                };
              } catch (transitionError) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Issue Updated:\n${result}\n\nStatus Transition Failed: ${transitionError}`,
                    },
                  ],
                };
              }
            }

            return {
              content: [
                {
                  type: "text",
                  text: `Issue Updated:\n${result}`,
                },
              ],
            };
          }

          case "jira_add_comment": {
            const { issue_key, comment } = args as {
              issue_key: string;
              comment: string;
            };

            // Use correct command: issue comment add
            const command = `issue comment add ${issue_key} "${comment}"`;
            const result = await this.execJira(command);

            return {
              content: [
                {
                  type: "text",
                  text: `Comment Added:\n${result}`,
                },
              ],
            };
          }

          case "jira_transition_issue": {
            const { issue_key, status } = args as {
              issue_key: string;
              status: string;
            };

            // Use correct command: issue move
            const command = `issue move ${issue_key} "${status}"`;
            const result = await this.execJira(command);

            return {
              content: [
                {
                  type: "text",
                  text: `Issue Transitioned:\n${result}`,
                },
              ],
            };
          }

          case "jira_list_projects": {
            // Use correct command: project list
            const command = `project list`;
            const result = await this.execJira(command);

            return {
              content: [
                {
                  type: "text",
                  text: `Projects:\n${result}`,
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
    console.error("Jira MCP server running on stdio");
  }
}

const server = new JiraMCPServer();
server.run().catch(console.error);
