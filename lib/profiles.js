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
    return { profiles: {}, active: null, mode: null, groups: {} };
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
  // Clean from all groups
  for (const group of Object.values(data.groups || {})) {
    group.members = (group.members || []).filter(m => m !== name);
  }
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
 * Get the mode: 'isolated' or 'unified'.
 */
export function getMode() {
  return loadProfiles().mode || 'isolated';
}

/**
 * Set the mode.
 */
export function setMode(mode) {
  if (!['isolated', 'unified', 'mixed'].includes(mode)) {
    throw new Error('Mode must be "isolated", "unified", or "mixed"');
  }
  const data = loadProfiles();
  data.mode = mode;
  saveProfiles(data);
}

// ============================================================
//  Groups (for mixed mode)
// ============================================================

/**
 * Create a group.
 */
export function createGroup(groupName) {
  validateProfileName(groupName);
  const data = loadProfiles();
  if (!data.groups) data.groups = {};
  if (data.groups[groupName]) {
    throw new Error(`Group "${groupName}" already exists.`);
  }
  data.groups[groupName] = { members: [], created: new Date().toISOString() };
  saveProfiles(data);
}

/**
 * Add a profile to a group.
 */
export function addToGroup(groupName, profileName) {
  validateProfileName(groupName);
  validateProfileName(profileName);
  const data = loadProfiles();
  if (!data.groups?.[groupName]) {
    throw new Error(`Group "${groupName}" doesn't exist. Create it with: claudemail group create ${groupName}`);
  }
  if (!data.profiles[profileName]) {
    throw new Error(`Profile "${profileName}" doesn't exist.`);
  }
  if (data.groups[groupName].members.includes(profileName)) {
    return false; // already in group
  }
  data.groups[groupName].members.push(profileName);
  saveProfiles(data);
  return true;
}

/**
 * Remove a profile from a group.
 */
export function removeFromGroup(groupName, profileName) {
  const data = loadProfiles();
  if (!data.groups?.[groupName]) return;
  data.groups[groupName].members = data.groups[groupName].members.filter(m => m !== profileName);
  saveProfiles(data);
}

/**
 * Delete a group.
 */
export function deleteGroup(groupName) {
  const data = loadProfiles();
  delete data.groups?.[groupName];
  saveProfiles(data);
}

/**
 * Get all groups.
 */
export function getGroups() {
  return loadProfiles().groups || {};
}

/**
 * Find which group a profile belongs to (if any).
 */
export function getProfileGroup(profileName) {
  const data = loadProfiles();
  for (const [groupName, group] of Object.entries(data.groups || {})) {
    if (group.members?.includes(profileName)) return groupName;
  }
  return null;
}

/**
 * Get the config directory for a profile (validated).
 * - isolated: each profile gets its own dir
 * - unified: all profiles share one dir
 * - mixed: profiles in the same group share a dir, ungrouped profiles are isolated
 */
export function getConfigDir(name) {
  validateProfileName(name);
  const mode = getMode();
  if (mode === 'unified') {
    return join(PROFILES_DIR, '_shared');
  }
  if (mode === 'mixed') {
    const group = getProfileGroup(name);
    if (group) return join(PROFILES_DIR, '_group_' + group);
  }
  return join(PROFILES_DIR, name);
}

/**
 * Get the active.sh path for shell integration.
 */
export function getActiveShellPath() {
  return join(PROFILES_DIR, 'active.sh');
}
