#!/usr/bin/env bun

import { $ } from "bun";
import { parseArgs } from "node:util";

// Types
type WorkspaceLayout =
	| "h_tiles"
	| "v_tiles"
	| "h_accordion"
	| "v_accordion"
	| "tiles"
	| "accordion"
	| "horizontal"
	| "vertical"
	| "tiling"
	| "floating";
type Orientation = "horizontal" | "vertical";
type Size = `${number}/${number}`;
interface LayoutWindow {
	bundleId: string;
}

interface LayoutWindowWithSize extends LayoutWindow {
	size: Size;
}

interface LayoutGroup {
	orientation: Orientation;
	windows: LayoutWindow[];
}

interface LayoutGroupWithSize extends LayoutGroup {
	size: Size;
}

type LayoutItem =
	| LayoutWindow
	| LayoutGroup
	| LayoutWindowWithSize
	| LayoutGroupWithSize;

type Layout = {
	workspace: string;
	layout: WorkspaceLayout;
	orientation: Orientation;
	windows: LayoutItem[];
	display?: string | number | DisplayAlias;
};

type LayoutConfig = {
	stashWorkspace: string;
	layouts: Record<string, Layout>;
};

type DisplayInfo = {
	id?: number;
	name: string;
	width: number;
	height: number;
	isMain: boolean;
	isInternal?: boolean;
};

// macOS system_profiler SPDisplaysDataType reporter's values
enum SPDisplaysValues {
	Yes = "spdisplays_yes",
	No = "spdisplays_no",
	Supported = "spdisplays_supported",
	Internal = "spdisplays_internal",
}

const SPDisplayCommand = "system_profiler SPDisplaysDataType -json";

enum DisplayAlias {
	Main = "main",
	Secondary = "secondary",
	External = "external",
	Internal = "internal",
}

type SPDisplaysDataType = {
	_name: string;
	spdisplays_ndrvs: {
		_name: string;
		"_spdisplays_display-product-id": string;
		"_spdisplays_display-serial-number": string;
		"_spdisplays_display-vendor-id": string;
		"_spdisplays_display-week": string;
		"_spdisplays_display-year": string;
		_spdisplays_displayID: string;
		_spdisplays_pixels: string; // Format: "width x height"
		_spdisplays_resolution: string; // Format: "width x height @ Hz"
		spdisplays_main: "spdisplays_yes" | "spdisplays_no";
		spdisplays_mirror: "spdisplays_off" | "spdisplays_on";
		spdisplays_online: "spdisplays_yes" | "spdisplays_no";
		spdisplays_pixelresolution: string; // Format: "width x height"
		spdisplays_resolution: string; // Format: "width x height @ Hz"
		spdisplays_rotation: "spdisplays_supported" | "spdisplays_not_supported";
		spdisplays_connection_type?: "spdisplays_internal" | string; // Optional as it may not be present for external displays
	}[];
};

// Setup

const args = parseArgs({
	args: process.argv.slice(2),
	options: {
		layout: { type: "string", short: "l" },
		configFile: {
			type: "string",
			short: "c",
			default: "~/.config/aerospace/layouts.json",
		},
		listLayouts: { type: "boolean", short: "L" },
		help: { type: "boolean", short: "h" },
		listDisplays: { type: "boolean", short: "d" },
		debug: { type: "boolean" },
	},
	strict: true,
	allowPositionals: true,
});

const DEBUG_MODE = args.values.debug || false;

// Conditional logging function
function debugLog(...args: any[]) {
	if (DEBUG_MODE) {
		console.log(...args);
	}
}

const layoutName = args.values.layout || args.positionals[0];
const configFilePath = await $`echo ${args.values.configFile}`.text();
const layoutConfig: LayoutConfig = await Bun.file(configFilePath.trim()).json();

if (args.values.listLayouts) {
	debugLog(Object.keys(layoutConfig.layouts).join("\n"));
	process.exit(0);
}

function printHelp() {
	debugLog(
		`\nAerospace Layout Manager\n\nUsage:\n  aerospace-layout-manager [options] <layout-name>\n\nOptions:\n  -l, --layout <layout-name>   Specify the layout name (can also be provided as the first positional argument)\n  -c, --configFile <path>      Path to the layout configuration file (default: ~/.config/aerospace/layouts.json)\n  -L, --listLayouts            List available layout names from the configuration file\n  -d, --listDisplays           List available display names\n  --debug                      Show detailed debug logging\n  -h, --help                   Show this help message and exit\n\nExamples:\n  # Apply the 'work' layout defined in the config\n  aerospace-layout-manager work\n\n  # Apply with debug logging\n  aerospace-layout-manager --debug work\n\n  # Same as above using the explicit flag\n  aerospace-layout-manager --layout work\n\n  # List all available layouts\n  aerospace-layout-manager --listLayouts\n\n  # List all available displays\n  aerospace-layout-manager --listDisplays\n`,
	);
}

// Show help and exit if requested explicitly
if (args.values.help || layoutName === "help") {
	printHelp();
	process.exit(0);
}

if (args.values.listDisplays) {
	const displays = await getDisplays();
	debugLog(displays.map((d) => d.name).join("\n"));
	process.exit(0);
}

if (!layoutName) {
	printHelp();
	process.exit(0);
}

debugLog(`[INFO] Loading layout: ${layoutName}`);
const layout = layoutConfig.layouts[layoutName] as Layout;
const stashWorkspace = layoutConfig.stashWorkspace ?? "S";

if (!layout) {
	throw new Error("Layout not found");
}

debugLog(`[INFO] Layout loaded successfully. Workspace: ${layout.workspace}`);

debugLog('[INFO] Detecting displays...');
const displays = await getDisplays();
if (!displays) {
	throw new Error(`No displays found. Please, debug with ${SPDisplayCommand}`);
}
debugLog(`[INFO] Found ${displays.length} display(s)`);
const selectedDisplay = layout.display
	? selectDisplay(layout, displays)
	: getDisplayByAlias(DisplayAlias.Main, displays);

if (!selectedDisplay) {
	throw new Error(
		`A display could not be selected for layout "${layoutName}". Please check your configuration.`,
	);
}

// Helpers

async function flattenWorkspace(workspace: string) {
	await execAerospaceCommand(
		["flatten-workspace-tree", "--workspace", workspace],
		1000, // 1 second timeout
		true,  // Optional - continue even if it times out
	);
}

async function switchToWorkspace(workspace: string) {
	await execAerospaceCommand(
		["workspace", workspace],
		1000,
	);
}

async function moveWindow(windowId: string, workspace: string) {
	await execAerospaceCommand(
		["move-node-to-workspace", "--window-id", windowId, workspace, "--focus-follows-window"],
		1000,
	);
}

async function getWindowsInWorkspace(workspace: string): Promise<
	{
		"app-name": string;
		"window-id": string;
		"window-title": string;
		"app-bundle-id": string;
	}[]
> {
	return await $`aerospace list-windows --workspace ${workspace} --json --format "%{window-id} %{app-name} %{window-title} %{app-bundle-id}"`.json();
}

async function joinItemWithPreviousWindow(windowId: string) {
	await execAerospaceCommand(
		["join-with", "--window-id", windowId, "left"],
		1000,
		true,  // Optional - can fail if no window in that direction
	);
}

async function focusWindow(windowId: string) {
	await execAerospaceCommand(
		["focus", "--window-id", windowId],
		1000,
	);
}

async function getDisplays(): Promise<DisplayInfo[]> {
	const data = await $`system_profiler SPDisplaysDataType -json`.json();

	return data.SPDisplaysDataType.flatMap((gpu: SPDisplaysDataType) =>
		gpu.spdisplays_ndrvs?.map((d) => ({
			name: d._name,
			id: Number.parseInt(d._spdisplays_displayID) || undefined,
			width: Number.parseInt(
				(d._spdisplays_resolution || d.spdisplays_resolution || "").split(
					" x ",
				)[0] || "0",
				10,
			),
			height: Number.parseInt(
				(d._spdisplays_resolution || d.spdisplays_resolution || "").split(
					" x ",
				)[1] || "0",
				10,
			),
			isMain: d.spdisplays_main === SPDisplaysValues.Yes,
			isInternal: d.spdisplays_connection_type === SPDisplaysValues.Internal,
		})),
	);
}

function getDisplayByAlias(
	alias: DisplayAlias,
	displays: DisplayInfo[],
): DisplayInfo | undefined {
	switch (alias) {
		case DisplayAlias.Main:
			return getMainDisplay(displays);
		case DisplayAlias.Secondary:
			if (displays.length < 2) {
				debugLog(
					"Alias 'secondary' is used, but only one display found. Defaulting to the main display.",
				);
				return getMainDisplay(displays);
			}
			if (displays.length > 2) {
				throw new Error(
					"Alias 'secondary' is used, but multiple secondary displays are found. Please specify an exact display name or use a different alias.",
				);
			}
			return displays.find((d) => !d.isMain);
		case DisplayAlias.External: {
			const externalDisplays = displays.filter((d) => !d.isInternal);
			if (externalDisplays.length === 0) {
				debugLog(
					"Alias 'external' is used, but no external displays found. Defaulting to the main display.",
				);
				return getMainDisplay(displays);
			}
			if (externalDisplays.length > 1) {
				throw new Error(
					"Multiple external displays found. Please specify an exact display name or use a different alias.",
				);
			}
			return externalDisplays[0];
		}
		case DisplayAlias.Internal:
			return displays.find((d) => d.isInternal);
	}
}

function getDisplayByName(
	regExp: string,
	displays: DisplayInfo[],
): DisplayInfo | undefined {
	return displays.find((d) => new RegExp(regExp, "i").test(d.name));
}

function getDisplayById(
	id: number,
	displays: DisplayInfo[],
): DisplayInfo | undefined {
	return displays.find((d) => d.id === id);
}

function getMainDisplay(displays: DisplayInfo[]): DisplayInfo | undefined {
	return displays.find((d) => d.isMain);
}

function selectDisplay(layout: Layout, displays: DisplayInfo[]): DisplayInfo {
	let selectedDisplay: DisplayInfo | undefined;
	if (layout.display) {
		if (
			typeof layout.display === "string" &&
			Number.isNaN(Number(layout.display))
		) {
			const isAlias = Object.values(DisplayAlias).includes(
				layout.display as DisplayAlias,
			);
			if (isAlias) {
				selectedDisplay = getDisplayByAlias(
					layout.display as DisplayAlias,
					displays,
				);
			} else {
				selectedDisplay = getDisplayByName(layout.display, displays);
			}
		} else if (
			typeof layout.display === "number" ||
			!Number.isNaN(Number(layout.display))
		) {
			const displayId = Number(layout.display);
			selectedDisplay = getDisplayById(displayId, displays);
		}
	}

	if (!selectedDisplay) {
		debugLog(
			`Display not found: ${layout.display}. Please specify a valid display name, alias, or ID. Defaulting to the main display.`,
		);
		selectedDisplay = getDisplayByAlias(
			DisplayAlias.Main,
			displays,
		) as DisplayInfo;
	}

	debugLog(
		`Using display: ${selectedDisplay.name} (${selectedDisplay.width}x${
			selectedDisplay.height
		}) (${selectedDisplay.isMain ? "main" : "secondary"}, ${
			selectedDisplay.isInternal ? "internal" : "external"
		})`,
	);

	return selectedDisplay;
}

/**
 * Return the width of the current (primary) display in pixels.
 * Uses AppleScript because Aerospace does not expose this information.
 */
async function getDisplayWidth(): Promise<number | null> {
	return selectedDisplay?.width ?? null;
}

async function getDisplayHeight(): Promise<number | null> {
	return selectedDisplay?.height ?? null;
}

// Functions

async function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ANSI color codes
const colors = {
	reset: "\x1b[0m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	gray: "\x1b[90m",
};

function colorize(text: string, color: keyof typeof colors): string {
	return `${colors[color]}${text}${colors.reset}`;
}

/**
 * Execute an aerospace command with timeout using spawn - with retry logic
 */
async function execAerospaceCommand(
	args: string[],
	timeoutMs: number = 1000,
	optional: boolean = false,
	maxRetries: number = 2,
): Promise<boolean> {
	const commandStr = `aerospace ${args.join(" ")}`;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		if (attempt > 1) {
			const retryDelay = 500 * attempt; // Increasing delay: 500ms, 1000ms, etc.
			debugLog(`[INFO] Retry attempt ${attempt}/${maxRetries} for: ${commandStr} (waiting ${retryDelay}ms)`);
			await delay(retryDelay);
		}

		debugLog(`[INFO] Executing: ${commandStr}${attempt > 1 ? ` (attempt ${attempt}/${maxRetries})` : ""}`);

		const startTime = Date.now();
		const proc = Bun.spawn(["aerospace", ...args], {
			stdout: "pipe",
			stderr: "pipe",
		});

		let timedOut = false;
		let killed = false;

		// Create a timeout that will forcefully kill the process
		const timeoutId = setTimeout(() => {
			const elapsed = Date.now() - startTime;
			timedOut = true;
			killed = true;
			const logLevel = optional ? "WARN" : "ERROR";
			const isLastAttempt = attempt === maxRetries;

			if (isLastAttempt) {
				const color = optional ? "yellow" : "red";
				const message = colorize(`[${logLevel}] Timeout: ${commandStr} exceeded ${timeoutMs}ms (elapsed: ${elapsed}ms) after ${maxRetries} attempts`, color);
				console[optional ? "warn" : "error"](message);
			} else {
				debugLog(colorize(`[INFO] Timeout: ${commandStr} exceeded ${timeoutMs}ms (elapsed: ${elapsed}ms) - will retry`, "cyan"));
			}

			if (optional) {
				debugLog(`[INFO] Continuing despite timeout (command is optional)`);
			}

			// Try SIGTERM first
			proc.kill();

			// Force SIGKILL after 100ms if still running
			setTimeout(() => {
				try {
					proc.kill(9); // SIGKILL
				} catch (e) {
					// Process may already be dead
				}
			}, 100);
		}, timeoutMs);

		// Race between process completion and timeout
		const timeoutPromise = new Promise<null>((resolve) => {
			setTimeout(() => {
				if (killed) {
					resolve(null);
				}
			}, timeoutMs + 200);
		});

		try {
			const exitCode = await Promise.race([
				proc.exited,
				timeoutPromise,
			]);

			clearTimeout(timeoutId);

			if (exitCode === null) {
				// Timed out - retry if not last attempt
				const elapsed = Date.now() - startTime;
			debugLog(colorize(`[INFO] Process forcefully terminated after ${elapsed}ms`, "red"));
				return optional;
			}

			const elapsed = Date.now() - startTime;
			if (exitCode === 0) {
				debugLog(`[INFO] Completed: ${commandStr} (${elapsed}ms)`);
				return true;
			} else if ((exitCode === 143 || exitCode === 137) && timedOut) {
				// Exit code 143 = SIGTERM, 137 = SIGKILL (killed by timeout)
				if (attempt < maxRetries && !optional) {
					continue; // Retry critical commands
				}
				debugLog(`[INFO] Command timed out${optional ? " but continuing (optional command)" : ""}`);
				return optional;
			} else {
				const stderr = await new Response(proc.stderr).text();
				const logLevel = optional ? "WARN" : "ERROR";
				console[optional ? "warn" : "error"](`[${logLevel}] Command failed: ${commandStr} (exit code: ${exitCode})`);
				if (stderr) {
					console[optional ? "warn" : "error"](`[${logLevel}] stderr: ${stderr}`);
				}
				return optional;
			}
		} catch (error) {
			clearTimeout(timeoutId);
			if (attempt < maxRetries) {
				debugLog(`[INFO] Exception in ${commandStr}, will retry: ${error}`);
				continue; // Retry on exception
			}
			const logLevel = optional ? "WARN" : "ERROR";
			console[optional ? "warn" : "error"](`[${logLevel}] Exception in ${commandStr}: ${error}`);
			return optional;
		}
	}

	// Should never reach here, but just in case
	return optional;
}

// remove all windows from workspace
async function clearWorkspace(workspace: string) {
	debugLog(`[INFO] Clearing workspace: ${workspace}`);
	const windows = await getWindowsInWorkspace(workspace);
	debugLog(`[INFO] Found ${windows.length} window(s) to move to stash`);

	for (const window of windows) {
		if (window["window-id"]) {
			debugLog(`[INFO] Moving window ${window["app-name"]} (${window["window-id"]}) to stash workspace`);
			await moveWindow(window["window-id"], stashWorkspace);
		}
	}
	debugLog(`[INFO] Workspace ${workspace} cleared`);
}

async function getWindowId(bundleId: string) {
	const bundleJson =
		await $`aerospace list-windows --monitor all --app-bundle-id "${bundleId}" --json`.json();
	const windowId = bundleJson?.length > 0 ? bundleJson[0]["window-id"] : null;
	if (!windowId) {
		debugLog("No windowId found for", bundleId);
	}
	return windowId;
}

async function launchIfNotRunning(bundleId: string) {
	const isRunning =
		(await $`osascript -e "application id \"${bundleId}\" is running" | grep -q true`.text()) ===
		"true";
	if (!isRunning) {
		await $`open -b "${bundleId}"`;
	}
}

async function ensureWindow(bundleId: string) {
	debugLog(`[INFO] Ensuring window for app: ${bundleId}`);
	await launchIfNotRunning(bundleId);
	for await (const i of Array(30)) {
		const windowId = await getWindowId(bundleId);
		if (windowId) {
			debugLog(`[INFO] Window found for ${bundleId}: ${windowId}`);
			return windowId;
		}
		if (i % 10 === 0 && i > 0) {
			debugLog(`[INFO] Still waiting for window ${bundleId}... (${i}/30 attempts)`);
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	debugLog(`[WARN] Window not found for ${bundleId} after 30 attempts`);
	return null;
}

async function setWorkspaceLayout(workspace: string, layout: WorkspaceLayout) {
	const workspaceWindows = await getWindowsInWorkspace(workspace);
	if (workspaceWindows.length > 0) {
		const windowId = workspaceWindows?.[0]?.["window-id"];
		await execAerospaceCommand(
			["layout", layout, "--window-id", windowId],
			2000,  // 2 second timeout
			true,  // Optional - continue even if it times out
		);
	} else {
		debugLog(`[WARN] No windows in workspace ${workspace} to set layout`);
	}
}

async function traverseTreeMove(tree: LayoutItem[], depth = 0) {
	debugLog(`[INFO] traverseTreeMove: Processing ${tree.length} item(s) at depth ${depth}`);
	for await (const [i, item] of tree.entries()) {
		if ("bundleId" in item) {
			debugLog(`[INFO] traverseTreeMove: Processing window ${i + 1}/${tree.length} - ${item.bundleId}`);
			const windowId = await ensureWindow(item.bundleId);

			if (windowId) {
				debugLog(`[INFO] Moving window ${item.bundleId} to workspace ${layout.workspace}`);
				await moveWindow(windowId, layout.workspace);
			}
		} else if ("windows" in item) {
			debugLog(`[INFO] traverseTreeMove: Entering nested group with ${item.windows.length} windows`);
			await traverseTreeMove(item.windows, depth + 1);
		}
		await delay(50); // Increased delay between window operations
	}
	debugLog(`[INFO] traverseTreeMove: Completed depth ${depth}`);
}

async function traverseTreeReposition(tree: LayoutItem[], depth = 0) {
	debugLog(`[INFO] traverseTreeReposition: Processing ${tree.length} item(s) at depth ${depth}`);
	for await (const [i, item] of tree.entries()) {
		if (depth === 0 && i === 0) {
			// set workspace layout after moving first window
			debugLog(`[INFO] Flattening workspace ${layout.workspace}`);
			await flattenWorkspace(layout.workspace);
			debugLog(`[INFO] Setting workspace layout to ${layout.layout}`);
			await setWorkspaceLayout(layout.workspace, layout.layout);
		}
		if ("bundleId" in item) {
			if (depth > 0 && i > 0) {
				// subsequent windows in a group should be joined with the previous window
				debugLog(`[INFO] Joining window ${item.bundleId} with previous window`);
				const windowId = await getWindowId(item.bundleId);
				if (windowId) {
					await focusWindow(windowId);
					await joinItemWithPreviousWindow(windowId);
				}
			}
		} else if ("windows" in item) {
			debugLog(`[INFO] traverseTreeReposition: section - ${item.orientation}, depth: ${depth}`);
			await traverseTreeReposition(item.windows, depth + 1);
		}
		await delay(50); // Increased delay between repositioning operations
	}
	debugLog(`[INFO] traverseTreeReposition: Completed depth ${depth}`);
}

async function resizeWindow(
	windowId: string,
	size: Size,
	dimension: "width" | "height",
) {
	debugLog(`[INFO] Resizing window ${windowId} to ${size} (${dimension})`);
	const screenDimension =
		dimension === "width" ? await getDisplayWidth() : await getDisplayHeight();
	const [numerator, denominator] = size.split("/").map(Number);
	debugLog(`[INFO] Screen ${dimension}: ${screenDimension}px, ratio: ${numerator}/${denominator}`);
	if (!screenDimension || !numerator || !denominator) {
		console.error(`[ERROR] Unable to determine display ${dimension}`);
		return;
	}
	const newWidth = Math.floor(screenDimension * (numerator / denominator));
	debugLog(`[INFO] New ${dimension}: ${newWidth}px`);
	await execAerospaceCommand(
		["resize", "--window-id", windowId, dimension, newWidth.toString()],
		1000,
		true,  // Optional - can fail for floating windows
	);
}

function getDimension(item: LayoutItem) {
	debugLog("Item:", item);
	if ("orientation" in item) {
		return item.orientation === "horizontal" ? "width" : "height";
	}
	return layout.orientation === "horizontal" ? "width" : "height";
}

async function traverseTreeResize(
	tree: LayoutItem[],
	depth = 0,
	parent: LayoutItem | null = null,
) {
	debugLog(`[INFO] traverseTreeResize: Processing ${tree.length} item(s) at depth ${depth}`);
	for await (const [i, item] of tree.entries()) {
		if ("size" in item && "bundleId" in item) {
			debugLog(`[INFO] Resizing window ${item.bundleId} to size ${item.size}`);
			const windowId = await getWindowId(item.bundleId);

			const dimension = getDimension(parent ?? item);
			await resizeWindow(windowId, item.size, dimension);
		} else if ("windows" in item) {
			const firstChildWindow = item.windows[0];
			debugLog(`[INFO] Parent:`, parent, "Item:", item);
			debugLog(`[INFO] First child window:`, firstChildWindow);
			if (
				"size" in item &&
				firstChildWindow &&
				"bundleId" in firstChildWindow
			) {
				debugLog(
					`[INFO] Resizing first child window: ${firstChildWindow.bundleId} to ${item.size}`,
				);
				const windowId = await getWindowId(firstChildWindow.bundleId);
				const dimension = parent
					? getDimension(parent)
					: layout.orientation === "horizontal"
						? "width"
						: "height";
				await resizeWindow(windowId, item.size, dimension);
			}
			await traverseTreeResize(item.windows, depth + 1, item);
		}
		await delay(50); // Increased delay between resize operations
	}
	debugLog(`[INFO] traverseTreeResize: Completed depth ${depth}`);
}

// Main
debugLog('[INFO] ========================================');
debugLog('[INFO] Starting layout application');
debugLog('[INFO] ========================================');

debugLog('[INFO] Step 1/5: Clearing workspace');
await clearWorkspace(layout.workspace);
await delay(100); // Longer delay after clearing workspace

debugLog('[INFO] Step 2/5: Moving windows to workspace');
await traverseTreeMove(layout.windows);
await delay(200); // Longer delay after moving windows

debugLog('[INFO] Step 3/5: Repositioning windows');
await traverseTreeReposition(layout.windows);
await delay(200); // Longer delay after repositioning

debugLog(`[INFO] Step 4/5: Switching to workspace ${layout.workspace}`);
await switchToWorkspace(layout.workspace);
await delay(100); // Longer delay after switching workspace

debugLog('[INFO] Step 5/5: Resizing windows');
await traverseTreeResize(layout.windows);

debugLog('[INFO] ========================================');
debugLog('[INFO] Layout application complete!');
debugLog('[INFO] ========================================');
