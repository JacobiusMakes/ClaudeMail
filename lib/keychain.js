/**
 * macOS Keychain wrapper for claudemail
 *
 * Stores OAuth tokens per profile using the `security` CLI.
 * Each profile gets its own keychain entry under service "claudemail".
 *
 * SECURITY: All shell commands use execFile() with argument arrays
 * to prevent injection via profile names or token values.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const SERVICE = 'claudemail';

/**
 * Store a token for a profile in the keychain.
 * Uses -U flag to update if entry already exists.
 */
export async function setToken(profile, token) {
  try {
    await execFileP('security', [
      'add-generic-password',
      '-s', SERVICE,
      '-a', profile,
      '-w', token,
      '-U',
    ], { timeout: 5000 });
    return true;
  } catch (err) {
    throw new Error(`Failed to store token in keychain: ${err.stderr || err.message}`);
  }
}

/**
 * Read a token for a profile from the keychain.
 * Returns null if not found.
 */
export async function getToken(profile) {
  try {
    const { stdout } = await execFileP('security', [
      'find-generic-password',
      '-s', SERVICE,
      '-a', profile,
      '-w',
    ], { timeout: 5000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Delete a profile's token from the keychain.
 */
export async function deleteToken(profile) {
  try {
    await execFileP('security', [
      'delete-generic-password',
      '-s', SERVICE,
      '-a', profile,
    ], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a token exists for a profile.
 */
export async function hasToken(profile) {
  const token = await getToken(profile);
  return token !== null;
}

/**
 * Read Claude Code's current OAuth token from the system keychain.
 * Claude stores credentials in "Claude Code-credentials" as JSON
 * with structure: { claudeAiOauth: { accessToken: "sk-ant-oat01-..." } }
 */
export async function getClaudeToken() {
  try {
    const { stdout } = await execFileP('security', [
      'find-generic-password',
      '-s', 'Claude Code-credentials',
      '-w',
    ], { timeout: 5000 });
    const data = JSON.parse(stdout.trim());
    return data?.claudeAiOauth?.accessToken || null;
  } catch {
    return null;
  }
}
