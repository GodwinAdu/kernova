# @nexus/cli

Developer tools for the Nexus Intelligent Systems Runtime.

## Installation

```bash
npm install -g @nexus/cli
```

## Commands

```bash
nexus init [name]       # Create a new Nexus project
nexus dev               # Start dev runtime + hot reload + Studio
nexus agent create <n>  # Generate agent boilerplate
nexus agent list        # List registered agents
nexus status            # Show runtime status
```

## Development Flow

```bash
nexus init my-app
cd my-app
npm install
nexus dev
# → Runtime starts, Studio at http://localhost:4200
# → Edit src/agents/*.ts → hot reloads automatically
```
