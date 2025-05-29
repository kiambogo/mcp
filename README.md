# MCP Repository

## Available MCPs

| MCP | Description | Tools |
|-----|-------------|-------|
| [Jira](./jira/) | Jira CLI integration | Search issues, create/update issues, add comments, transition status, list projects |
| [Confluence](./confluence/) | Confluence REST API integration | Search pages, get page content, list spaces, get space info, list pages, get child pages |

## Quick Start

Use the included Makefile for easy building:

```bash
# Build all MCPs
make all

# Build individual MCPs
make build-jira
make build-confluence

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
   # Install dependencies for both MCPs
   cd jira && npm install && cd ../confluence && npm install && cd ..
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
