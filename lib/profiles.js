/**
 * Profile registry manager for claudemail
 *
 * Manages ~/.claude/profiles/profiles.json — the index of all named profiles.
 *
 * SECURITY:
 * - Profile names are validated (alphanumeric + dash/underscore only)
 * - Files created with 0o600, directories with 0o700
 * - Path traversal prevented via validation + resolve check
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';

export const PROFILES_DIR = join(homedir(), '.claude', 'profiles');
export const PROFILES_PATH = join(PROFILES_DIR, 'profiles.json');

// ============================================================
//  Profile Name Validation
// ============================================================

const SAFE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

/**
 * Validate a profile name is safe for use in paths and shell commands.
 * @param {string} name
 * @throws {Error} if name is invalid
 */
export function validateProfileName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Profile name is required.');
  }
  if (!SAFE_NAME_RE.test(name)) {
    throw new Error(
      `Invalid profile name "${name}". Use only letters, numbers, dashes, underscores, and dots. ` +
      `Must start with a letter or number. Max 64 characters.`
    );
  }
  // Belt-and-suspenders: reject anything that resolves outside PROFILES_DIR
  const resolved = resolve(PROFILES_DIR, name);
  if (!resolved.startsWith(PROFILES_DIR + '/')) {
    throw new Error(`Profile name "${name}" would escape the profiles directory.`);
  }
}

// ============================================================
//  Profile Registry
// ============================================================

/**
 * Load all profiles from disk.
 * Returns { profiles: { [name]: { email, created, lastUsed } }, active: string|null }
 */
export function loadProfiles() {
  try {
    return JSON.parse(readFileSync(PROFILES_PATH, 'utf-8'));
  } catch {
    return { profiles: {}, active: null };
  }
}

/**
 * Save profiles to disk with secure permissions.
 */
export function saveProfiles(data) {
  mkdirSync(PROFILES_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(PROFILES_PATH, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}

/**
 * Add or update a profile entry.
 */
export function addProfile(name, email) {
  validateProfileName(name);
  const data = loadProfiles();
  data.profiles[name] = {
    email: email || null,
    created: data.profiles[name]?.created || new Date().toISOString(),
    lastUsed: new Date().toISOString(),
  };
  saveProfiles(data);
}

/**
 * Remove a profile entry.
 */
export function removeProfile(name) {
  validateProfileName(name);
  const data = loadProfiles();
  delete data.profiles[name];
  if (data.active === name) data.active = null;
  saveProfiles(data);
}

/**
 * Get the currently active profile name.
 */
export function getActive() {
  return loadProfiles().active;
}

/**
 * Set the active profile.
 */
export function setActive(name) {
  validateProfileName(name);
  const data = loadProfiles();
  if (!data.profiles[name]) {
    throw new Error(`Profile "${name}" does not exist. Run: claudemail add ${name}`);
  }
  data.active = name;
  data.profiles[name].lastUsed = new Date().toISOString();
  saveProfiles(data);
}

/**
 * Get the config directory for a profile (validated).
 */
export function getConfigDir(name) {
  validateProfileName(name);
  return join(PROFILES_DIR, name);
}

/**
 * Get the active.sh path for shell integration.
 */
export function getActiveShellPath() {
  return join(PROFILES_DIR, 'active.sh');
}
