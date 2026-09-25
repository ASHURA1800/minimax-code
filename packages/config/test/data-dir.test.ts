import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getLegacyDataDirPath,
  getPrimaryDataDirPath,
  resolveDataDir,
} from "../src/data-dir.js";

// ── platform / env helpers ──────────────────────────────────────

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}

const ENV_KEYS = ["XDG_DATA_HOME", "MINIMAX_DATA_DIR", "MAVIS_DATA_DIR"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  setPlatform(originalPlatform);
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

// ── fs fixture helpers ───────────────────────────────────────────

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "minimax-data-dir-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const noopLogger = { error: () => undefined, info: () => undefined, warn: () => undefined };

function writeMarkerFile(dir: string, name = "marker.txt", content = "data"): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

// ── 1 & 2: Linux XDG_DATA_HOME resolution ───────────────────────

describe("getPrimaryDataDirPath on Linux", () => {
  beforeEach(() => setPlatform("linux"));

  it("uses $XDG_DATA_HOME/minimax when XDG_DATA_HOME is set", () => {
    const xdgHome = path.join(root, "custom-xdg");
    process.env.XDG_DATA_HOME = xdgHome;
    expect(getPrimaryDataDirPath(root)).toBe(path.join(xdgHome, "minimax"));
  });

  it("uses ~/.local/share/minimax when XDG_DATA_HOME is unset", () => {
    expect(getPrimaryDataDirPath(root)).toBe(
      path.join(root, ".local", "share", "minimax"),
    );
  });

  it("ignores an empty/whitespace XDG_DATA_HOME and falls back to the default", () => {
    process.env.XDG_DATA_HOME = "   ";
    expect(getPrimaryDataDirPath(root)).toBe(
      path.join(root, ".local", "share", "minimax"),
    );
  });

  it("keeps the legacy path at ~/.mavis regardless of XDG_DATA_HOME", () => {
    process.env.XDG_DATA_HOME = path.join(root, "custom-xdg");
    expect(getLegacyDataDirPath(root)).toBe(path.join(root, ".mavis"));
  });

  it("appends the profile suffix under the XDG basename", () => {
    expect(getPrimaryDataDirPath(root, "feature-x")).toBe(
      path.join(root, ".local", "share", "minimax-feature-x"),
    );
  });
});

// ── 3: existing ~/.mavis migration ────────────────────────────

describe("resolveDataDir on Linux: existing ~/.mavis migration", () => {
  beforeEach(() => setPlatform("linux"));

  it("migrates data from ~/.mavis into $XDG_DATA_HOME/minimax and leaves a compat symlink", () => {
    const legacyDir = path.join(root, ".mavis");
    writeMarkerFile(legacyDir, "config.yaml", "logLevel: info");

    const resolved = resolveDataDir({ homeDir: root, logger: noopLogger });

    const expectedPrimary = path.join(root, ".local", "share", "minimax");
    expect(resolved).toBe(expectedPrimary);

    // Data remains accessible at the new primary location.
    expect(fs.readFileSync(path.join(expectedPrimary, "config.yaml"), "utf8")).toBe(
      "logLevel: info",
    );

    // The legacy path is now a symlink pointing at the primary dir, so old
    // scripts / tools that hardcode ~/.mavis keep working.
    const legacyStat = fs.lstatSync(legacyDir);
    expect(legacyStat.isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(legacyDir)).toBe(fs.realpathSync(expectedPrimary));

    // Reading through the compat symlink returns the migrated data.
    expect(fs.readFileSync(path.join(legacyDir, "config.yaml"), "utf8")).toBe(
      "logLevel: info",
    );
  });

  it("respects a custom XDG_DATA_HOME during migration", () => {
    const legacyDir = path.join(root, ".mavis");
    writeMarkerFile(legacyDir);
    const xdgHome = path.join(root, "custom-xdg");
    process.env.XDG_DATA_HOME = xdgHome;

    const resolved = resolveDataDir({ homeDir: root, logger: noopLogger });

    expect(resolved).toBe(path.join(xdgHome, "minimax"));
    expect(fs.existsSync(path.join(xdgHome, "minimax", "marker.txt"))).toBe(true);
    expect(fs.lstatSync(legacyDir).isSymbolicLink()).toBe(true);
  });
});

// ── 4: existing XDG directory (with legacy also present) ───────

describe("resolveDataDir on Linux: existing XDG directory", () => {
  beforeEach(() => setPlatform("linux"));

  it("uses the existing XDG location when already populated (fresh XDG, no legacy dir)", () => {
    const expectedPrimary = path.join(root, ".local", "share", "minimax");
    writeMarkerFile(expectedPrimary, "already-here.txt");

    const resolved = resolveDataDir({ homeDir: root, logger: noopLogger });

    expect(resolved).toBe(expectedPrimary);
    // Existing data is untouched.
    expect(fs.existsSync(path.join(expectedPrimary, "already-here.txt"))).toBe(true);
    // A compat symlink is created/ensured at the legacy path.
    expect(fs.lstatSync(path.join(root, ".mavis")).isSymbolicLink()).toBe(true);
  });

  it("prioritizes the populated XDG dir over a populated legacy dir without destroying either", () => {
    const primaryDir = path.join(root, ".local", "share", "minimax");
    const legacyDir = path.join(root, ".mavis");
    writeMarkerFile(primaryDir, "primary.txt", "primary-data");
    writeMarkerFile(legacyDir, "legacy.txt", "legacy-data");

    const resolved = resolveDataDir({ homeDir: root, logger: noopLogger });

    expect(resolved).toBe(primaryDir);
    // Primary data is preserved and used.
    expect(fs.readFileSync(path.join(primaryDir, "primary.txt"), "utf8")).toBe(
      "primary-data",
    );
    // No destructive overwrite: the legacy directory's real data was backed
    // up (renamed), not deleted, before the compat symlink was created.
    const legacyState = fs.lstatSync(legacyDir);
    expect(legacyState.isSymbolicLink()).toBe(true);
    const backupDirs = fs
      .readdirSync(path.join(root))
      .filter((name) => name.startsWith(".mavis.backup-"));
    expect(backupDirs.length).toBe(1);
    expect(
      fs.readFileSync(path.join(root, backupDirs[0]!, "legacy.txt"), "utf8"),
    ).toBe("legacy-data");
  });
});

// ── 5 & 6: explicit MINIMAX_DATA_DIR / MAVIS_DATA_DIR bypass XDG ─

describe("getDataDir(): explicit data-dir env vars bypass XDG resolution", () => {
  beforeEach(() => setPlatform("linux"));

  it("MINIMAX_DATA_DIR bypasses XDG logic entirely, even when XDG_DATA_HOME is set", async () => {
    const explicitDir = path.join(root, "explicit-minimax-dir");
    process.env.MINIMAX_DATA_DIR = explicitDir;
    process.env.XDG_DATA_HOME = path.join(root, "custom-xdg");

    const { getDataDir } = await import("../src/config.js");
    expect(getDataDir()).toBe(explicitDir);
  });

  it("MAVIS_DATA_DIR bypasses XDG logic entirely, even when XDG_DATA_HOME is set", async () => {
    const explicitDir = path.join(root, "explicit-mavis-dir");
    process.env.MAVIS_DATA_DIR = explicitDir;
    process.env.XDG_DATA_HOME = path.join(root, "custom-xdg");

    const { getDataDir } = await import("../src/config.js");
    expect(getDataDir()).toBe(explicitDir);
  });
});

// ── 7: macOS unaffected ──────────────────────────────────────────

describe("getPrimaryDataDirPath on macOS", () => {
  beforeEach(() => setPlatform("darwin"));

  it("continues to use ~/.minimax and ignores XDG_DATA_HOME", () => {
    process.env.XDG_DATA_HOME = path.join(root, "custom-xdg");
    expect(getPrimaryDataDirPath(root)).toBe(path.join(root, ".minimax"));
  });

  it("keeps primary and legacy paths distinct (primary=~/.minimax, legacy=~/.mavis)", () => {
    expect(getPrimaryDataDirPath(root)).toBe(path.join(root, ".minimax"));
    expect(getLegacyDataDirPath(root)).toBe(path.join(root, ".mavis"));
  });
});

// ── 8: Windows unaffected ────────────────────────────────────────

describe("getPrimaryDataDirPath on Windows", () => {
  beforeEach(() => setPlatform("win32"));

  it("continues to use %USERPROFILE%\\.minimax and ignores XDG_DATA_HOME", () => {
    process.env.XDG_DATA_HOME = path.join(root, "custom-xdg");
    expect(getPrimaryDataDirPath(root)).toBe(path.join(root, ".minimax"));
  });

  it("keeps primary and legacy paths distinct (primary=~/.minimax, legacy=~/.mavis)", () => {
    expect(getPrimaryDataDirPath(root)).toBe(path.join(root, ".minimax"));
    expect(getLegacyDataDirPath(root)).toBe(path.join(root, ".mavis"));
  });
});
