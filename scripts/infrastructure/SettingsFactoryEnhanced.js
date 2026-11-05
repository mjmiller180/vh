/**
 * Enhanced Settings Factory with Keyword Compilation Service
 * This class is used exclusively by the service worker.
 *
 * This factory extends the basic SettingsFactory to include the
 * KeywordCompilationService and other services needed for the DI migration.
 */

import { SettingsMgrDI } from "/scripts/core/services/SettingsMgrDI.js";
import { ChromeStorageAdapter, MemoryStorageAdapter } from "/scripts/infrastructure/StorageAdapter.js";
import { RuntimeAdapter, MockRuntimeAdapter } from "/scripts/infrastructure/RuntimeAdapter.js";
import { DIContainer } from "/scripts/infrastructure/DIContainer.js";
import { Logger } from "/scripts/core/utils/Logger.js";

// Create a separate DI container for the service worker to avoid conflicts as "storage"
// needs to be ChromeLocalStorage where the rest of the extension uses ServiceWorkerStorageAdapter
const serviceWorkerContainer = new DIContainer();

// Detect if we're in a test environment
const isTestEnvironment = typeof process !== "undefined" && process.env.NODE_ENV === "test";

// Register the storage adapter
serviceWorkerContainer.register(
	"storage",
	() => {
		if (isTestEnvironment) {
			return new MemoryStorageAdapter();
		}
		return new ChromeStorageAdapter("local");
	},
	{
		singleton: true,
	}
);

// Register the runtime adapter
serviceWorkerContainer.register(
	"runtimeAdapter",
	() => {
		if (isTestEnvironment) {
			return new MockRuntimeAdapter();
		}
		return new RuntimeAdapter();
	},
	{
		singleton: true,
	}
);

// Register the logger
serviceWorkerContainer.register(
	"logger",
	() => {
		return new Logger();
	},
	{
		singleton: true,
	}
);

// Register the settings manager
serviceWorkerContainer.register(
	"settingsManager",
	(storage, logger) => {
		return new SettingsMgrDI(storage, logger);
	},
	{
		singleton: true,
		dependencies: ["storage", "logger"],
	}
);

// Keyword compilation service removed - now handled by SettingsMgrDI

/**
 * Initialize all services
 * This should be called once at application startup
 */
export async function initializeServices() {
	try {
		// Initialize the settings manager
		const settings = await serviceWorkerContainer.resolve("settingsManager");
		await settings.waitForLoad();

		console.log("[SettingsFactory] All services initialized successfully");
	} catch (error) {
		console.error("[SettingsFactory] Failed to initialize services:", error);
		throw error;
	}
}

/**
 * Get the global DI container
 * @returns {DIContainer}
 */
export function getContainer() {
	return serviceWorkerContainer;
}

/**
 * Get the settings manager instance
 */
export function getSettingsManager() {
	return serviceWorkerContainer.resolve("settingsManager");
}

/**
 * Get the runtime adapter
 */
export function getRuntimeAdapter() {
	return serviceWorkerContainer.resolve("runtimeAdapter");
}

/**
 * Create a test container with mock services
 * @returns {DIContainer}
 */
export function createTestContainer() {
	const { DIContainer } = require("/scripts/infrastructure/DIContainer.js");
	const testContainer = new DIContainer();

	// Register mock services
	testContainer.register("storage", () => new MemoryStorageAdapter(), { singleton: true });
	testContainer.register("runtimeAdapter", () => new MockRuntimeAdapter(), { singleton: true });
	testContainer.register(
		"logger",
		() => ({
			add: jest.fn(),
			error: jest.fn(),
			warn: jest.fn(),
		}),
		{ singleton: true }
	);

	// Register real services that depend on mocks
	testContainer.register("settingsManager", (storage, logger) => new SettingsMgrDI(storage, logger), {
		singleton: true,
		dependencies: ["storage", "logger"],
	});

	return testContainer;
}

/**
 * Clear all services (useful for testing)
 */
export function clearServices() {
	serviceWorkerContainer.clear();
}
