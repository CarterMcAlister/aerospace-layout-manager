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
	},
	strict: true,
	allowPositionals: true,
});

const layoutName = args.values.layout || args.positionals[0];
const configFilePath = await $`echo ${args.values.configFile}`.text();
const layoutConfig: LayoutConfig = await Bun.file(configFilePath.trim()).json();

if (args.values.listLayouts) {
	console.log(Object.keys(layoutConfig.layouts).join("\n"));
	process.exit(0);
}

function printHelp() {
	console.log(
		`\nAerospace Layout Manager\n\nUsage:\n  aerospace-layout-manager [options] <layout-name>\n\nOptions:\n  -l, --layout <layout-name>   Specify the layout name (can also be provided as the first positional argument)\n  -c, --configFile <path>      Path to the layout configuration file (default: ~/.config/aerospace/layouts.json)\n  -L, --listLayouts            List available layout names from the configuration file\n  -d, --listDisplays           List available display names\n  -h, --help                   Show this help message and exit\n\nExamples:\n  # Apply the 'work' layout defined in the config\n  aerospace-layout-manager work\n\n  # Same as above using the explicit flag\n  aerospace-layout-manager --layout work\n\n  # List all available layouts\n  aerospace-layout-manager --listLayouts\n\n  # List all available displays\n  aerospace-layout-manager --listDisplays\n`,
	);
}

// Show help and exit if requested explicitly
if (args.values.help || layoutName === "help") {
	printHelp();
	process.exit(0);
}

if (args.values.listDisplays) {
	const displays = await getDisplays();
	console.log(displays.map((d) => d.name).join("\n"));
	process.exit(0);
}

if (!layoutName) {
	printHelp();
	process.exit(0);
}

const layout = layoutConfig.layouts[layoutName] as Layout;
const stashWorkspace = layoutConfig.stashWorkspace ?? "S";

if (!layout) {
	throw new Error("Layout not found");
}

const displays = await getDisplays();
if (!displays) {
	throw new Error(`No displays found. Please, debug with ${SPDisplayCommand}`);
}
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
	await $`aerospace flatten-workspace-tree --workspace ${workspace}`.nothrow();
}

async function switchToWorkspace(workspace: string) {
	await $`aerospace workspace ${workspace}`.nothrow();
}

async function moveWindow(windowId: string, workspace: string) {
	await $`aerospace move-node-to-workspace --window-id "${windowId}" "${workspace}" --focus-follows-window`;
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
	await $`aerospace join-with --window-id ${windowId} left`.nothrow();
}

async function focusWindow(windowId: string) {
	await $`aerospace focus --window-id ${windowId}`.nothrow();
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
				console.log(
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
				console.log(
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
		console.log(
			`Display not found: ${layout.display}. Please specify a valid display name, alias, or ID. Defaulting to the main display.`,
		);
		selectedDisplay = getDisplayByAlias(
			DisplayAlias.Main,
			displays,
		) as DisplayInfo;
	}

	console.log(
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

// remove all windows from workspace
async function clearWorkspace(workspace: string) {
	const windows = await getWindowsInWorkspace(workspace);

	for (const window of windows) {
		if (window["window-id"]) {
			await moveWindow(window["window-id"], stashWorkspace);
		}
	}
}

async function getWindowId(bundleId: string) {
	const bundleJson =
		await $`aerospace list-windows --monitor all --app-bundle-id "${bundleId}" --json`.json();
	const windowId = bundleJson?.length > 0 ? bundleJson[0]["window-id"] : null;
	if (!windowId) {
		console.log("No windowId found for", bundleId);
	}
	return windowId;
}

async function launchIfNotRunning(bundleId: string) {
	const result = await $`osascript -e "application id \"${bundleId}\" is running"`.text();
	const isRunning = result.trim() === "true";
	if (!isRunning) {
		await $`open -b "${bundleId}"`;
	}
}

async function ensureWindow(bundleId: string) {
	await launchIfNotRunning(bundleId);
	for await (const i of Array(30)) {
		const windowId = await getWindowId(bundleId);
		if (windowId) {
			return windowId;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return null;
}

async function setWorkspaceLayout(workspace: string, layout: WorkspaceLayout) {
	const workspaceWindows = await getWindowsInWorkspace(workspace);
	if (workspaceWindows.length > 0) {
		const windowId = workspaceWindows?.[0]?.["window-id"];
		await $`aerospace layout ${layout} --window-id ${windowId}`.nothrow();
	}
}

async function traverseTreeMove(tree: LayoutItem[], depth = 0) {
	for await (const [i, item] of tree.entries()) {
		if ("bundleId" in item) {
			const windowId = await ensureWindow(item.bundleId);

			if (windowId) {
				await moveWindow(windowId, layout.workspace);
			}
		} else if ("windows" in item) {
			await traverseTreeMove(item.windows, depth + 1);
		}
	}
}

async function traverseTreeReposition(tree: LayoutItem[], depth = 0) {
	for await (const [i, item] of tree.entries()) {
		if (depth === 0 && i === 0) {
			// set workspace layout after moving first window
			await flattenWorkspace(layout.workspace);
			await setWorkspaceLayout(layout.workspace, layout.layout);
		}
		if ("bundleId" in item) {
			if (depth > 0 && i > 0) {
				// subsequent windows in a group should be joined with the previous window
				const windowId = await getWindowId(item.bundleId);
				if (windowId) {
					await focusWindow(windowId);
					await joinItemWithPreviousWindow(windowId);
				}
			}
		} else if ("windows" in item) {
			console.log("section:", item.orientation, "depth:", depth);
			await traverseTreeReposition(item.windows, depth + 1);
		}
	}
}

async function resizeWindow(
	windowId: string,
	size: Size,
	dimension: "width" | "height",
) {
	console.log("Resizing window", windowId, "to", size);
	const screenDimension =
		dimension === "width" ? await getDisplayWidth() : await getDisplayHeight();
	const [numerator, denominator] = size.split("/").map(Number);
	console.log("Screen dimension:", screenDimension);
	console.log("Numerator:", numerator);
	console.log("Denominator:", denominator);
	if (!screenDimension || !numerator || !denominator) {
		console.error("Unable to determine display width");
		return;
	}
	const newWidth = Math.floor(screenDimension * (numerator / denominator));
	console.log("New width:", newWidth);
	console.log(
		"Command:",
		`aerospace resize --window-id ${windowId} ${dimension} ${newWidth}`,
	);
	await $`aerospace resize --window-id ${windowId} ${dimension} ${newWidth}`.nothrow();
}

function getDimension(item: LayoutItem) {
	console.log("Item:", item);
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
	for await (const [i, item] of tree.entries()) {
		if ("size" in item && "bundleId" in item) {
			const windowId = await getWindowId(item.bundleId);

			const dimension = getDimension(parent ?? item);
			await resizeWindow(windowId, item.size, dimension);
		} else if ("windows" in item) {
			const firstChildWindow = item.windows[0];
			console.log("Parent:", parent, "Item:", item);
			console.log("First child window:", firstChildWindow);
			if (
				"size" in item &&
				firstChildWindow &&
				"bundleId" in firstChildWindow
			) {
				console.log(
					"Resizing first child window:",
					firstChildWindow.bundleId,
					"to",
					item.size,
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
	}
}

// Main
await clearWorkspace(layout.workspace);
await traverseTreeMove(layout.windows);
await traverseTreeReposition(layout.windows);
await switchToWorkspace(layout.workspace);
await traverseTreeResize(layout.windows);
