# Atlas CLI Reference

> Source: https://www.mongodb.com/docs/atlas/cli/current/

Atlas CLI manages MongoDB Atlas from the terminal.
**MongoBranch uses Atlas CLI for local development** and as a plugin target.

## Installation

```bash
brew install mongodb-atlas-cli     # macOS
# or: npm install -g mongodb-atlas-cli
atlas --version
```

## Authentication

```bash
atlas auth login                   # Browser-based OAuth
atlas auth whoami                  # Check current user
atlas config init                  # Set up default profile
```

## Local Development (Docker-based)

```bash
# Set up local Atlas deployment (replica set in Docker)
atlas deployments setup mydev --type local

# List local deployments
atlas deployments list

# Start/stop local deployment
atlas deployments start mydev
atlas deployments pause mydev

# Delete local deployment
atlas deployments delete mydev

# Connect via mongosh
atlas deployments connect mydev
```

**Why local matters for MongoBranch**: Local deployment gives you:
- Replica set (required for change streams)
- Atlas Search support
- No cloud costs during development
- Full feature parity for testing

## Cluster Management

```bash
# Create cloud cluster
atlas clusters create myCluster --tier M10 --region US_EAST_1

# List clusters
atlas clusters list

# Describe cluster
atlas clusters describe myCluster

# Delete cluster
atlas clusters delete myCluster
```

## Database User Management

```bash
atlas dbusers create --username dev --password pass --role readWriteAnyDatabase
atlas dbusers list
atlas dbusers delete dev
```

## Network Access

```bash
atlas accessLists create --currentIp
atlas accessLists create --entry "0.0.0.0/0" --comment "Allow all (dev only)"
```

## Atlas Search

```bash
atlas clusters search indexes create --clusterName myCluster --file index.json
atlas clusters search indexes list --clusterName myCluster --db mydb --collection users
```

## Atlas CLI Plugins (v1.41+)

```bash
# Atlas CLI supports custom plugins
atlas plugin install <plugin-name>
atlas plugin list
atlas plugin uninstall <plugin-name>
```

**MongoBranch as Atlas CLI Plugin**: We can build MongoBranch as a plugin:
```bash
# Future goal:
atlas mongobranch create feature-1
atlas mongobranch diff feature-1 main
atlas mongobranch merge feature-1 --into main
```

## Data Import/Export

```bash
# Import JSON data
mongoimport --uri "mongodb://localhost:27017" --db mydb --collection users --file data.json

# Export data
mongoexport --uri "mongodb://localhost:27017" --db mydb --collection users --out data.json

# Dump entire database
mongodump --uri "mongodb://localhost:27017" --db mydb --out ./dump

# Restore database
mongorestore --uri "mongodb://localhost:27017" --db mydb ./dump/mydb
```

## MongoBranch Local Setup

For a fresh external consumer workspace, MongoBranch now prefers:

```bash
mb init --db myapp --start-local
mb doctor
mb access status
```

That flow writes `.mongobranch.yaml`, writes an auth-enabled Atlas Local Docker Compose file,
starts the local deployment, and proves the runtime with live capability and RBAC enforcement probes.

Inside the MongoBranch repo itself, contributors still use Docker Compose directly:

```yaml
# Port 27017 (MongoDB default for Atlas Local Docker)
# `preview` tag = latest MongoDB + experimental features (Search, auto-embedding)
services:
  mongobranch:
    image: mongodb/mongodb-atlas-local:preview
    ports:
      - 27017:27017
```

```bash
docker compose up -d          # Start Atlas Local on port 27017
bun test                       # Tests auto-detect and connect
docker compose down            # Stop when done
```

## MongoBranch Relevance

| Feature | MongoBranch Use |
|---------|-----------------|
| Atlas Local Docker (port 27017) | Development + testing with full Atlas features |
| `mb init --start-local` | Fastest install-to-ready path for new Bun consumer workspaces |
| Plugins | MongoBranch as `atlas` plugin (Wave 4) |
| Import/Export | Branch snapshot backup/restore |
| Search indexes | Branching Atlas Search configurations |
