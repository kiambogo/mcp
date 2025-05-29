# MCP Repository Makefile
# Build and manage multiple MCP servers

.PHONY: help all build-all build-jira build-confluence dev-jira dev-confluence check-deps

# Default target
help:
	@echo "Available targets:"
	@echo "  help              - Show this help message"
	@echo "  all               - Build all MCPs"
	@echo "  build-jira        - Build Jira MCP only"
	@echo "  build-confluence  - Build Confluence MCP only"
	@echo "  check-deps        - Check if required tools are installed"

# Build all components
all: build-jira build-confluence

build-jira:
	@echo "Building Jira MCP..."
	@cd jira && rm -rf build/
	@cd jira && npm run build > /dev/null
	@echo "✅ Jira MCP built successfully"

build-confluence:
	@echo "Building Confluence MCP..."
	@cd confluence && rm -rf build/
	@cd confluence && npm run build > /dev/null
	@echo "✅ Confluence MCP built successfully"

# Utility targets
check-deps:
	@echo "Checking if required tools are installed..."
	@command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required but not installed."; exit 1; }
	@command -v npm >/dev/null 2>&1 || { echo "❌ npm is required but not installed."; exit 1; }
	@command -v op >/dev/null 2>&1 || { echo "⚠️  1Password CLI (op) not found. Install with: brew install 1password-cli"; }
	@echo "✅ Dependencies check completed" 