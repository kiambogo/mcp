# MCP Repository

## Available MCPs

| MCP | Description | Tools |
|-----|-------------|-------|
| [Jira](./jira/) | Jira CLI integration | Search issues, create/update issues, add comments, transition status, list projects |
| [Confluence](./confluence/) | Confluence REST API integration | Search pages, get page content, list spaces, get space info, list pages, get child pages |
| [Slack](./slack/) | Slack API integration (read-only) | Search messages, read channels/threads, parse permalinks, get user/channel info |

## Quick Start

Use the included Makefile for easy building:

```bash
# Build all MCPs
make all

# Build individual MCPs
make build-jira
make build-confluence
make build-slack

# Check dependencies
make check-deps

# Get help
make help
```

## Setup Instructions

### Prerequisites

1. **Install dependencies:**
   ```bash
   # Install Node.js and npm (if not already installed)
   # Install 1Password CLI for secure credential management
   brew install 1password-cli
   
   # For Jira MCP only: Install Jira CLI
   brew install jira-cli
   ```

2. **Install Node.js dependencies:**
   ```bash
   # Install dependencies for all MCPs
   cd jira && npm install && cd ../confluence && npm install && cd ../slack && npm install && cd ..
   ```

### Jira MCP

1. **Store your Jira API token in 1Password:**
   - Create an item named "Jira API Key" 
   - Store your API token in the password field

2. **Build the MCP server:**
   ```bash
   # Using Makefile (recommended)
   make build-jira
   
   # Or manually
   cd jira && npm run build
   ```

### Confluence MCP

1. **Store your Confluence API credentials in 1Password:**
   - Create an item named "Confluence API Key"
   - Add these fields:
     - `username`: Your Confluence email address
     - `password`: Your Confluence API token
     - `base url`: Your Confluence base URL (e.g., `https://yourcompany.atlassian.net`)

2. **Build the MCP server:**
   ```bash
   # Using Makefile (recommended)
   make build-confluence
   
   # Or manually
   cd confluence && npm run build
   ```

### Slack MCP

1. **Create a Slack App and get API token:**
   - Go to [api.slack.com](https://api.slack.com/apps)
   - Create a new app for your workspace
   - Add the following OAuth scopes:
     - `channels:history`, `channels:read`
     - `groups:history`, `groups:read` (for private channels)
     - `search:read`, `users:read`
   - Install the app to your workspace and copy the OAuth token

2. **Store your Slack API token in 1Password:**
   - Create an item named "Slack API Token"
   - Store your OAuth token in the password field

3. **Build the MCP server:**
   ```bash
   # Using Makefile (recommended)
   make build-slack
   
   # Or manually
   cd slack && npm run build
   ```

## Claude Integration

Add to your Claude MCP configuration file (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/path/to/your/repo/jira/build/index.js"]
    },
    "confluence": {
      "command": "node", 
      "args": ["/path/to/your/repo/confluence/build/index.js"]
    },
    "slack": {
      "command": "node",
      "args": ["/path/to/your/repo/slack/build/index.js"]
    }
  }
}
```

**Note:** Replace `/path/to/your/repo` with the actual path to this repository.

## Usage

### Jira MCP
Once configured, you can use Claude to:
- Search Jira issues with JQL queries
- View issue details
- Create and update issues
- Add comments and transition statuses
- List available projects

### Confluence MCP
Once configured, you can use Claude to:
- Search Confluence pages using text queries
- Retrieve full page content in various formats
- List and explore Confluence spaces
- Navigate page hierarchies and find child pages
- Get detailed space information

### Slack MCP
Once configured, you can use Claude to:
- Search messages across your Slack workspace
- Read channel messages and thread discussions
- Parse and understand Slack permalink URLs
- Get information about channels and users
- Research previous conversations on specific topics
