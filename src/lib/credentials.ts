import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

/**
 * Expand `~` to the user's home directory.
 */
export function expandHome(filePath: string): string {
  if (filePath.startsWith("~/") || filePath === "~") {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

/**
 * Run a PowerShell script by writing it to a temp file first.
 * This avoids here-string escaping issues with inline -Command.
 */
function runPowerShellScript(script: string, timeoutMs = 10000): string | null {
  const tmpFile = path.join(os.tmpdir(), `openusage_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
  try {
    fs.writeFileSync(tmpFile, script, "utf-8");
    const result = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`,
      { encoding: "utf-8", timeout: timeoutMs, stdio: ["pipe", "pipe", "pipe"] }
    );
    return result.trim() || null;
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

const CRED_READ_CS = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class CredManager {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public int Flags;
    public int Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public int Persist;
    public int AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")]
  private static extern void CredFree(IntPtr cred);
  public static string Read(string target) {
    IntPtr credPtr;
    if (!CredRead(target, 1, 0, out credPtr)) return null;
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));
      if (c.CredentialBlobSize > 0 && c.CredentialBlob != IntPtr.Zero) {
        return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
      }
      return null;
    } finally { CredFree(credPtr); }
  }
}
"@ -ErrorAction Stop
`;

const CRED_WRITE_CS = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class CredWriter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public int Flags;
    public int Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public int Persist;
    public int AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool CredWrite(ref CREDENTIAL cred, int flags);
  public static bool Write(string target, string user, string pass) {
    byte[] blob = Encoding.Unicode.GetBytes(pass);
    CREDENTIAL c = new CREDENTIAL();
    c.Type = 1;
    c.TargetName = target;
    c.UserName = user;
    c.CredentialBlobSize = blob.Length;
    c.CredentialBlob = Marshal.AllocHGlobal(blob.Length);
    Marshal.Copy(blob, 0, c.CredentialBlob, blob.Length);
    c.Persist = 2;
    try { return CredWrite(ref c, 0); }
    finally { Marshal.FreeHGlobal(c.CredentialBlob); }
  }
}
"@ -ErrorAction Stop
`;

/**
 * Read a credential from the OS keyring.
 * - macOS: uses `security find-generic-password`
 * - Windows: uses PowerShell temp file + advapi32 CredRead via P/Invoke
 * Returns the stored password string, or null if not found.
 */
export function readKeyringPassword(service: string, account: string): string | null {
  try {
    if (process.platform === "darwin") {
      // macOS Keychain
      const result = execSync(
        `security find-generic-password -s ${JSON.stringify(service)} -a ${JSON.stringify(account)} -w`,
        { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
      );
      return result.trim() || null;
    }

    if (process.platform === "win32") {
      // Windows Credential Manager via advapi32 CredRead
      // The Rust `keyring` crate stores with target format: "{account}@{service}"
      const target = `${account}@${service}`;
      const script = CRED_READ_CS + `[CredManager]::Read('${target.replace(/'/g, "''")}')`;
      return runPowerShellScript(script);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Write a credential to the OS keyring.
 * - macOS: uses `security add-generic-password`
 * - Windows: uses PowerShell temp file + advapi32 CredWrite via P/Invoke
 */
export function writeKeyringPassword(service: string, account: string, password: string): boolean {
  try {
    if (process.platform === "darwin") {
      // Delete existing, then add new
      try {
        execSync(
          `security delete-generic-password -s ${JSON.stringify(service)} -a ${JSON.stringify(account)}`,
          { stdio: ["pipe", "pipe", "pipe"], timeout: 5000 }
        );
      } catch {
        // Ignore — may not exist
      }
      execSync(
        `security add-generic-password -s ${JSON.stringify(service)} -a ${JSON.stringify(account)} -w ${JSON.stringify(password)}`,
        { stdio: ["pipe", "pipe", "pipe"], timeout: 5000 }
      );
      return true;
    }

    if (process.platform === "win32") {
      const target = `${account}@${service}`;
      const escaped = password.replace(/'/g, "''");
      const script = CRED_WRITE_CS + `[CredWriter]::Write('${target.replace(/'/g, "''")}', '${account.replace(/'/g, "''")}', '${escaped}')`;
      const result = runPowerShellScript(script);
      return result !== null;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Read and parse a JSON credentials file. Returns null if not found or invalid.
 */
export function readJsonFile<T = Record<string, unknown>>(filePath: string): T | null {
  const resolved = expandHome(filePath);
  try {
    if (!fs.existsSync(resolved)) {
      return null;
    }
    const text = fs.readFileSync(resolved, "utf-8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Write JSON data to a credentials file (for token refresh persistence).
 */
export function writeJsonFile(filePath: string, data: unknown): boolean {
  const resolved = expandHome(filePath);
  try {
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolved, JSON.stringify(data), "utf-8");
    return true;
  } catch {
    return false;
  }
}
