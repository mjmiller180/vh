/**
 * Settings Factory
 *
 * This factory provides a bridge between the old singleton pattern
 * and the new DI-based approach. It allows gradual migration while
 * maintaining backward compatibility.
 */

import { SettingsMgrDI } from "../core/services/SettingsMgrDI.js";
import { ChromeStorageAdapter, ServiceWorkerStorageAdapter } from "./StorageAdapter.js";
import { container } from "./DIContainer.js";
import { isSafari } from "../core/utils/BrowserDetection.js";
import { Logger } from "../core/utils/Logger.js";

// Register the logger if needed (using existing Logger)
container.register(
	"logger",
	() => {
		// Dynamic import to avoid circular dependencies
		return new Logger();
	},
	{
		singleton: true,
	}
);

// Register the storage adapter in the DI container
container.register(
	"storageAdapter",
	() => {
		const logger = container.resolve("logger");
		// Safari doesn't support service workers, so use localStorage instead
		if (isSafari()) {
			logger.add("Using ServiceWorkerStorageAdapter");
			return new ServiceWorkerStorageAdapter();
		}
		logger.add("Using ChromeStorageAdapter(local)");
		return new ChromeStorageAdapter("local");
	},
	{
		singleton: true,
	}
);

// Register the SettingsMgrDI with its dependencies
container.register(
	"settingsManager",
	(storageAdapter) => {
		return new SettingsMgrDI(storageAdapter);
	},
	{
		singleton: true,
		dependencies: ["storageAdapter"],
	}
);

/**
 * Factory function to get the settings manager instance
 * This maintains backward compatibility with code expecting a singleton
 */
export function getSettingsManager() {
	return container.resolve("settingsManager");
}
