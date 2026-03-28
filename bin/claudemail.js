#!/usr/bin/env node

/**
 * claudemail — Multi-account profile manager for Claude Code
 *
 * Switch between email accounts without re-authenticating.
 * Stores tokens securely in macOS Keychain, isolates config per profile.
 *
 * Usage:
 *   claudemail add work --email jacob@work.com
 *   claudemail add personal --email jacob@gmail.com
 *   claudemail list
 *   claudemail switch work
 *   claudemail run personal -- -p "hello"
 */

import { Command } from 'commander';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import readline from 'node:readline';

import { setToken, getToken, deleteToken, hasToken, getClaudeToken } from '../lib/keychain.js';
import {
  loadProfiles, saveProfiles, addProfile, removeProfile,
  getActive, setActive, getConfigDir, getActiveShellPath,
  validateProfileName, getMode, setMode,
  createGroup, addToGroup, removeFromGroup, deleteGroup,
  getGroups, getProfileGroup, PROFILES_DIR,
} from '../lib/profiles.js';

// ============================================================
//  Colors
// ============================================================

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
};

// ============================================================
//  CLI
// ============================================================

const program = new Command();

program
  .name('claudemail')
  .description('Multi-account profile manager for Claude Code')
  .version('0.1.0');

// ── add ──

program
  .command('add <name>')
  .description('Add a new profile — triggers Claude login and captures the token')
  .option('-e, --email <email>', 'Email address for this profile')
  .action(async (name, opts) => {
    // Validate profile name
    validateProfileName(name);

    // First-run: ask about mode if not set yet
    const data = loadProfiles();
    if (!data.mode) {
      const rl0 = readline.createInterface({ input: process.stdin, output: process.stdout });
      console.log(`${c.bold}First time setup — how should your profiles work?${c.reset}\n`);
      console.log(`  1) ${c.bold}Isolated${c.reset}  — Separate sessions per account.`);
      console.log(`     ${c.dim}Work stays work, personal stays personal.${c.reset}`);
      console.log(`     ${c.dim}Switching profiles = clean context.${c.reset}\n`);
      console.log(`  2) ${c.bold}Unified${c.reset}   — Shared session, different accounts.`);
      console.log(`     ${c.dim}Claude keeps context across all profiles.${c.reset}`);
      console.log(`     ${c.dim}"Check both inboxes" works in one conversation.${c.reset}\n`);
      console.log(`  3) ${c.bold}Mixed${c.reset}     — Aggregate email groups.`);
      console.log(`     ${c.dim}Group profiles into custom clusters (e.g. "dev" = work + GitHub).${c.reset}`);
      console.log(`     ${c.dim}Profiles in the same group share context. Groups stay separate.${c.reset}\n`);

      const modeChoice = await new Promise((resolve) => {
        rl0.question(`${c.dim}Enter 1-3 [default: 1]: ${c.reset}`, (ans) => {
          resolve(ans.trim() || '1');
        });
      });
      rl0.close();

      const modeMap = { '1': 'isolated', '2': 'unified', '3': 'mixed' };
      const mode = modeMap[modeChoice] || 'isolated';
      setMode(mode);
      console.log(`${c.green}Mode set to: ${c.bold}${mode}${c.reset}`);
      if (mode === 'mixed') {
        console.log(`${c.dim}Create groups with: claudemail group create <name>${c.reset}`);
        console.log(`${c.dim}Add profiles to groups: claudemail group add <group> <profile>${c.reset}`);
      }
      console.log(`${c.dim}Change anytime with: claudemail mode <isolated|unified|mixed>${c.reset}\n`);
    }

    const configDir = getConfigDir(name);
    mkdirSync(configDir, { recursive: true, mode: 0o700 });

    console.log(`${c.bold}Adding profile: ${c.cyan}${name}${c.reset}`);
    if (opts.email) {
      console.log(`${c.dim}Email: ${opts.email}${c.reset}`);
    }
    console.log('');

    // Ask user: login interactively or paste a token?
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const method = await new Promise((resolve) => {
      console.log(`${c.bold}How do you want to authenticate?${c.reset}`);
      console.log('  1) Interactive login (opens browser)');
      console.log('  2) Paste an existing OAuth token or API key');
      console.log('  3) Capture current Claude session token');
      rl.question(`${c.dim}Enter 1-3 [default: 1]: ${c.reset}`, (ans) => {
        resolve(ans.trim() || '1');
      });
    });

    let token = null;

    if (method === '1') {
      // Interactive login
      console.log(`\n${c.yellow}Launching Claude login...${c.reset}`);
      console.log(`${c.dim}Complete the login in your browser, then come back here.${c.reset}\n`);

      const loginArgs = ['auth', 'login'];
      if (opts.email) loginArgs.push('--email', opts.email);

      const loginProc = spawn('claude', loginArgs, {
        stdio: 'inherit',
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
      });

      await new Promise((resolve) => loginProc.on('close', resolve));

      // Grab the token that was just stored in keychain
      token = await getClaudeToken();
      if (!token) {
        console.error(`${c.red}Could not read token after login. Try method 2 or 3.${c.reset}`);
        rl.close();
        process.exit(1);
      }
    } else if (method === '2') {
      // Paste token
      token = await new Promise((resolve) => {
        rl.question(`${c.dim}Paste your OAuth token or API key: ${c.reset}`, (ans) => {
          resolve(ans.trim());
        });
      });
      if (!token) {
        console.error(`${c.red}No token provided.${c.reset}`);
        rl.close();
        process.exit(1);
      }
    } else if (method === '3') {
      // Capture current session
      token = await getClaudeToken();
      if (!token) {
        console.error(`${c.red}No active Claude session found in keychain.${c.reset}`);
        console.error('Run `claude auth login` first, then try again.');
        rl.close();
        process.exit(1);
      }
      console.log(`${c.green}Captured current session token.${c.reset}`);
    }

    rl.close();

    // Store in our keychain
    await setToken(name, token);
    addProfile(name, opts.email);

    // If no email provided, try to detect it
    if (!opts.email) {
      console.log(`${c.dim}Tip: add --email to tag this profile, e.g.: claudemail add ${name} --email you@gmail.com${c.reset}`);
    }

    console.log(`\n${c.green}Profile "${name}" created.${c.reset}`);
    console.log(`${c.dim}Use: claudemail switch ${name}${c.reset}`);
    console.log(`${c.dim} or: claudemail run ${name} -- -p "hello"${c.reset}`);
  });

// ── list ──

program
  .command('list')
  .description('List all profiles')
  .action(async () => {
    const data = loadProfiles();
    const names = Object.keys(data.profiles);

    if (names.length === 0) {
      console.log(`${c.dim}No profiles yet. Run: claudemail add <name> --email you@gmail.com${c.reset}`);
      return;
    }

    console.log(`${c.bold}Profiles:${c.reset}\n`);

    const active = data.active;
    for (const name of names) {
      const p = data.profiles[name];
      const hasKey = await hasToken(name);
      const isActive = name === active;

      const marker = isActive ? `${c.green}* ` : '  ';
      const status = hasKey ? `${c.green}[key]${c.reset}` : `${c.red}[no key]${c.reset}`;
      const email = p.email ? `${c.cyan}${p.email}${c.reset}` : `${c.dim}(no email)${c.reset}`;

      console.log(`${marker}${c.bold}${name}${c.reset}  ${email}  ${status}`);

      if (p.lastUsed) {
        const ago = timeSince(new Date(p.lastUsed));
        console.log(`${c.dim}    Last used: ${ago}${c.reset}`);
      }
    }

    console.log('');
    if (active) {
      console.log(`${c.dim}Active: ${active} (${c.green}*${c.dim})${c.reset}`);
    } else {
      console.log(`${c.dim}No active profile. Run: claudemail switch <name>${c.reset}`);
    }
  });

// ── switch ──

program
  .command('switch <name>')
  .description('Set the active profile for new terminal sessions')
  .action(async (name) => {
    const data = loadProfiles();
    if (!data.profiles[name]) {
      console.error(`${c.red}Profile "${name}" not found.${c.reset}`);
      console.error(`Available: ${Object.keys(data.profiles).join(', ') || 'none'}`);
      process.exit(1);
    }

    const token = await getToken(name);
    if (!token) {
      console.error(`${c.red}No token found for "${name}". Re-add with: claudemail add ${name}${c.reset}`);
      process.exit(1);
    }

    // Update registry
    setActive(name);

    // Write shell snippet
    const configDir = getConfigDir(name);
    mkdirSync(configDir, { recursive: true });

    const shellPath = getActiveShellPath();
    // SECURITY: escape token for shell (single quotes prevent expansion)
    const safeToken = token.replace(/'/g, "'\\''");
    const safeDir = configDir.replace(/'/g, "'\\''");
    const shellContent = [
      `# claudemail active profile: ${name}`,
      `# Generated: ${new Date().toISOString()}`,
      `export CLAUDE_CODE_OAUTH_TOKEN='${safeToken}'`,
      `export CLAUDE_CONFIG_DIR='${safeDir}'`,
      '',
    ].join('\n');

    writeFileSync(shellPath, shellContent, { mode: 0o600 });

    const email = data.profiles[name].email;
    console.log(`${c.green}Switched to: ${c.bold}${name}${c.reset}${email ? ` (${c.cyan}${email}${c.reset})` : ''}`);
    console.log('');
    console.log(`${c.bold}To activate in this terminal:${c.reset}`);
    console.log(`  source ${shellPath}`);
    console.log('');
    console.log(`${c.bold}To auto-activate in new terminals, add to ~/.zshrc:${c.reset}`);
    console.log(`  [ -f ${shellPath} ] && source ${shellPath}`);
    console.log('');
    console.log(`${c.dim}Or use directly: claudemail run ${name} -- <claude args>${c.reset}`);
  });

// ── run ──

program
  .command('run <name>')
  .description('Run a claude command using a specific profile')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(async (name, _opts, cmd) => {
    const data = loadProfiles();
    if (!data.profiles[name]) {
      console.error(`${c.red}Profile "${name}" not found.${c.reset}`);
      process.exit(1);
    }

    const token = await getToken(name);
    if (!token) {
      console.error(`${c.red}No token for "${name}".${c.reset}`);
      process.exit(1);
    }

    // Everything after -- is passed to claude
    const rawArgs = process.argv;
    const dashDash = rawArgs.indexOf('--');
    const claudeArgs = dashDash >= 0 ? rawArgs.slice(dashDash + 1) : [];

    if (claudeArgs.length === 0) {
      // No args — launch interactive claude
      claudeArgs.push();
    }

    const configDir = getConfigDir(name);
    mkdirSync(configDir, { recursive: true });

    // Update last used
    data.profiles[name].lastUsed = new Date().toISOString();
    saveProfiles(data);

    const proc = spawn('claude', claudeArgs, {
      stdio: 'inherit',
      env: {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: token,
        CLAUDE_CONFIG_DIR: configDir,
      },
    });

    proc.on('close', (code) => process.exit(code || 0));
    proc.on('error', (err) => {
      console.error(`${c.red}Failed to run claude: ${err.message}${c.reset}`);
      process.exit(1);
    });
  });

// ── remove ──

program
  .command('remove <name>')
  .description('Remove a profile and its keychain entry')
  .action(async (name) => {
    const data = loadProfiles();
    if (!data.profiles[name]) {
      console.error(`${c.red}Profile "${name}" not found.${c.reset}`);
      process.exit(1);
    }

    // Confirm
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const confirm = await new Promise((resolve) => {
      rl.question(`${c.yellow}Remove profile "${name}" and delete its config? [y/N]: ${c.reset}`, (ans) => {
        resolve(ans.trim().toLowerCase());
      });
    });
    rl.close();

    if (confirm !== 'y' && confirm !== 'yes') {
      console.log('Cancelled.');
      return;
    }

    // Delete keychain entry
    await deleteToken(name);

    // Delete config directory
    const configDir = getConfigDir(name);
    if (existsSync(configDir)) {
      rmSync(configDir, { recursive: true, force: true });
    }

    // Remove from registry
    removeProfile(name);

    // Clear active.sh if this was the active profile
    if (data.active === name) {
      const shellPath = getActiveShellPath();
      if (existsSync(shellPath)) {
        writeFileSync(shellPath, '# No active profile\n');
      }
    }

    console.log(`${c.green}Profile "${name}" removed.${c.reset}`);
  });

// ── status ──

program
  .command('status')
  .description('Show current active profile and auth status')
  .action(async () => {
    const data = loadProfiles();
    const active = data.active;
    const profileCount = Object.keys(data.profiles).length;

    const mode = getMode();
    console.log(`${c.bold}claudemail status${c.reset}\n`);
    console.log(`  Profiles: ${profileCount}`);
    console.log(`  Mode:     ${c.cyan}${mode}${c.reset}`);
    console.log(`  Active:   ${active ? `${c.green}${active}${c.reset}` : `${c.dim}none${c.reset}`}`);

    if (active && data.profiles[active]) {
      const email = data.profiles[active].email;
      if (email) console.log(`  Email:    ${c.cyan}${email}${c.reset}`);

      // Check auth status with this profile
      const token = await getToken(active);
      if (token) {
        console.log(`  Token:    ${c.green}present${c.reset}`);

        // Verify by running claude auth status
        try {
          const configDir = getConfigDir(active);
          const result = execSync('claude auth status', {
            encoding: 'utf-8',
            timeout: 10000,
            env: {
              ...process.env,
              CLAUDE_CODE_OAUTH_TOKEN: token,
              CLAUDE_CONFIG_DIR: configDir,
            },
          });
          const status = JSON.parse(result);
          console.log(`  Auth:     ${status.loggedIn ? `${c.green}logged in${c.reset}` : `${c.red}not logged in${c.reset}`}`);
          console.log(`  Method:   ${status.authMethod || 'unknown'}`);
        } catch {
          console.log(`  Auth:     ${c.yellow}could not verify${c.reset}`);
        }
      } else {
        console.log(`  Token:    ${c.red}missing${c.reset}`);
      }
    }

    // Show env var state
    console.log('');
    console.log(`${c.dim}Environment:${c.reset}`);
    console.log(`  CLAUDE_CODE_OAUTH_TOKEN: ${process.env.CLAUDE_CODE_OAUTH_TOKEN ? `${c.green}set${c.reset}` : `${c.dim}not set${c.reset}`}`);
    console.log(`  CLAUDE_CONFIG_DIR:       ${process.env.CLAUDE_CONFIG_DIR || `${c.dim}default (~/.claude)${c.reset}`}`);
  });

// ── mode ──

program
  .command('mode [value]')
  .description('View or change profile mode (isolated / unified / mixed)')
  .action(async (value) => {
    if (!value) {
      const current = getMode();
      console.log(`${c.bold}Current mode: ${c.cyan}${current}${c.reset}\n`);
      console.log(`  ${c.bold}isolated${c.reset}  — Separate sessions per account. Switching = clean context.`);
      console.log(`  ${c.bold}unified${c.reset}   — Shared session. Claude sees everything across accounts.`);
      console.log(`  ${c.bold}mixed${c.reset}     — Aggregate email groups. Profiles in a group share context.\n`);
      console.log(`${c.dim}Change with: claudemail mode <isolated|unified|mixed>${c.reset}`);
      return;
    }

    if (!['isolated', 'unified', 'mixed'].includes(value)) {
      console.error(`${c.red}Invalid mode "${value}". Use "isolated", "unified", or "mixed".${c.reset}`);
      process.exit(1);
    }

    setMode(value);
    console.log(`${c.green}Mode changed to: ${c.bold}${value}${c.reset}`);

    if (value === 'unified') {
      console.log(`${c.dim}All profiles will now share one session context.${c.reset}`);
    } else if (value === 'mixed') {
      console.log(`${c.dim}Profiles in the same group share context. Ungrouped profiles stay isolated.${c.reset}`);
      console.log(`${c.dim}Manage groups: claudemail group create|add|remove|delete|list${c.reset}`);
    } else {
      console.log(`${c.dim}Each profile now gets its own isolated session.${c.reset}`);
    }
  });

// ── group ──

const groupCmd = program
  .command('group')
  .description('Manage profile groups (for mixed mode)');

groupCmd
  .command('create <name>')
  .description('Create a new group')
  .action(async (name) => {
    createGroup(name);
    console.log(`${c.green}Group "${name}" created.${c.reset}`);
    console.log(`${c.dim}Add profiles: claudemail group add ${name} <profile>${c.reset}`);
  });

groupCmd
  .command('add <group> <profile>')
  .description('Add a profile to a group')
  .action(async (group, profile) => {
    addToGroup(group, profile);
    console.log(`${c.green}Added "${profile}" to group "${group}".${c.reset}`);

    // Show the group
    const groups = getGroups();
    const members = groups[group]?.members || [];
    console.log(`${c.dim}Group "${group}": ${members.join(', ')}${c.reset}`);
    console.log(`${c.dim}These profiles now share session context in mixed mode.${c.reset}`);
  });

groupCmd
  .command('remove <group> <profile>')
  .description('Remove a profile from a group')
  .action(async (group, profile) => {
    removeFromGroup(group, profile);
    console.log(`${c.green}Removed "${profile}" from group "${group}".${c.reset}`);
  });

groupCmd
  .command('delete <name>')
  .description('Delete a group (profiles are not affected)')
  .action(async (name) => {
    deleteGroup(name);
    console.log(`${c.green}Group "${name}" deleted. Profiles remain intact.${c.reset}`);
  });

groupCmd
  .command('list')
  .description('List all groups and their members')
  .action(async () => {
    const groups = getGroups();
    const names = Object.keys(groups);

    if (names.length === 0) {
      console.log(`${c.dim}No groups yet. Create one: claudemail group create <name>${c.reset}`);
      return;
    }

    console.log(`${c.bold}Groups:${c.reset}\n`);
    for (const name of names) {
      const members = groups[name].members || [];
      const memberList = members.length > 0
        ? members.map(m => `${c.cyan}${m}${c.reset}`).join(', ')
        : `${c.dim}(empty)${c.reset}`;
      console.log(`  ${c.bold}${name}${c.reset}  ${memberList}`);
    }
    console.log(`\n${c.dim}Profiles in the same group share session context in mixed mode.${c.reset}`);
  });

// ── Helper ──

function timeSince(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ── Parse ──

if (process.argv.length <= 2) {
  program.help();
}

program.parse();
