# MCP Repository

## Available MCPs

| MCP | Description | Tools |
|-----|-------------|-------|
| [Jira](./jira/) | Jira CLI integration | Search issues, create/update issues, add comments, transition status, list projects |

## Setup Instructions

### Jira MCP

1. **Install dependencies:**
   ```bash
   # Install Jira CLI
   brew install jira-cli
   
   # Install 1Password CLI (for API token management)
   brew install 1password-cli
   ```

2. **Store your Jira API token in 1Password:**
   - Create an item named "Jira API Key" 
   - Store your API token in the password field

3. **Build the MCP server:**
   ```bash
   cd jira
   npm install
   npm run build
   ```

## Claude Integration

Add to your Claude MCP configuration file (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/path/to/your/repo/jira/build/index.js"]
    }
  }
}
```

**Note:** Replace `/path/to/your/repo` with the actual path to this repository.

## Usage

Once configured, you can use Claude to:
- Search Jira issues with JQL queries
- View issue details
- Create and update issues
- Add comments and transition statuses
- List available projects
