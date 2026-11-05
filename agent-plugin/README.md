# Garmin — Agent Plugins package

Portable [Agent Plugins](https://agent-plugins.org/) v1 package for
[Hermes Agent](https://github.com/NousResearch/hermes-agent) and other Agent Plugins clients:
the `garmin` MCP server (`garmin-mcp-unofficial@0.8.0` over stdio) plus the `garmin-mcp` workflow skill.

## Install (Hermes Agent)

```bash
hermes plugins install davidmosiah/garmin-mcp/agent-plugin --no-enable
hermes plugins enable garmin-mcp
```

Requires Node.js 20+ (`npx` on PATH). The skill loads as `garmin-mcp:garmin-mcp`.

## Connector setup

```bash
npx -y garmin-mcp-unofficial@0.8.0 setup --client generic
npx -y garmin-mcp-unofficial@0.8.0 auth
npx -y garmin-mcp-unofficial@0.8.0 doctor
```

`--client generic` keeps setup from writing a second Hermes server entry. `auth` asks for the Garmin Connect email, password and MFA code in the user's own terminal and saves only the resulting tokens to `~/.garmin-mcp/garmin_tokens.json`; the password is not stored.

## Disclosure

Runs the `garmin-mcp-unofficial@0.8.0` npm package locally over stdio through `npx` (Node.js 20+ required); the package is downloaded from npm on first start. Data source: Garmin Connect in unofficial personal mode (Garmin has no public consumer API): the user logs in locally once and the connector reuses the resulting Garmin Connect tokens. Credentials and OAuth tokens are created by the connector's own `setup`/`auth` commands in the user's terminal and stay on the machine (`~/.garmin-mcp/`); the plugin declares no environment variables and reads no Hermes credentials. Tools that change state: garmin_profile_update (local profile only); garmin_disconnect_local (deletes the local Garmin tokens). Unofficial: Garmin may change or rate-limit the private Connect endpoints this mode relies on. The tool set comes from the pinned npm version, not from this repository's source tree.
