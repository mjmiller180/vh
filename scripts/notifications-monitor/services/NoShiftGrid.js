/**
 * NoShiftGrid - Manages placeholder tiles to prevent grid shifting
 *
 * This class handles the insertion and management of placeholder tiles in the grid
 * to maintain consistent layout and prevent items from shifting positions when
 * new items are added or the grid is filtered.
 */
const TYPE_DATE_ASC = "date_asc";
const TYPE_DATE_DESC = "date_desc";
const TYPE_PRICE_DESC = "price_desc";
const TYPE_PRICE_ASC = "price_asc";

class NoShiftGrid {
	#lastInsertPlaceholderTilesTime = 0;

	constructor(monitor) {
		this._monitor = monitor;
		this._gridContainer = null;
		this._gridWidth = 0;
		this._resizeTimeout = null;
		this._endPlaceholdersCount = 0;
		this._endPlaceholdersCountBuffer = 0; //Buffer to keep the tally during a pause.
		this._visibleItemsCount = 0;
		this._lastInsertPlaceholderTilesTime = Date.now();

		// Cache for tile width calculation
		// IMPORTANT: This cache prevents recalculation during filter changes
		// Without caching, placeholder counts can be lost when the grid is temporarily empty
		// The cache is only cleared on resize/zoom events, not by time
		this._cachedTileWidth = null;
		this._retryPending = false; // Flag to prevent multiple retry attempts

		this._boundResizeHandler = this._resizeHandler.bind(this);
	}

	/**
	 * Update the grid container (compatibility method for old API)
	 * @param {HTMLElement} gridContainer - The grid container element
	 */
	updateGridContainer(gridContainer) {
		// Call the new initialize method for compatibility
		this.initialize(gridContainer);
	}

	/**
	 * Initialize the NoShiftGrid with a grid container
	 * @param {HTMLElement} gridContainer - The grid container element
	 */
	initialize(gridContainer) {
		this._gridContainer = gridContainer;
		this._updateGridWidth();

		// Clear cache when grid container changes
		this._clearTileWidthCache();

		// Set up resize observer
		if (window.ResizeObserver) {
			this._resizeObserver = new ResizeObserver(this._boundResizeHandler);
			this._resizeObserver.observe(this._gridContainer);
		} else {
			// Fallback to window resize event
			window.addEventListener("resize", this._boundResizeHandler);
		}
	}

	/**
	 * Clean up resources
	 */
	destroy() {
		if (this._resizeObserver) {
			this._resizeObserver.disconnect();
		} else {
			window.removeEventListener("resize", this._boundResizeHandler);
		}

		if (this._resizeTimeout) {
			clearTimeout(this._resizeTimeout);
		}
	}

	/**
	 * Handle resize events with debouncing
	 * @private
	 */
	_resizeHandler() {
		if (this._resizeTimeout) {
			clearTimeout(this._resizeTimeout);
		}

		this._resizeTimeout = setTimeout(() => {
			const oldWidth = this._gridWidth;
			this._updateGridWidth();

			if (Math.abs(oldWidth - this._gridWidth) > 1) {
				// Clear cache on resize as tile sizes may have changed
				this._clearTileWidthCache();

				const debugPlaceholders = this._monitor._settings?.get("general.debugPlaceholders");
				if (debugPlaceholders) {
					console.log("[NoShiftGrid] Resize/zoom detected, recalculating grid width", {
						oldWidth: oldWidth,
						newWidth: this._gridWidth,
					});
				}

				if (
					Date.now() - this.#lastInsertPlaceholderTilesTime > 100 &&
					this._monitor._sortType == TYPE_DATE_DESC
				) {
					this.insertPlaceholderTiles();
				}
			}
		}, 100);
	}

	/**
	 * Clear the tile width cache
	 * @private
	 */
	_clearTileWidthCache() {
		const debugPlaceholders = this._monitor._settings?.get("general.debugPlaceholders");

		// Don't clear cache during atomic updates or while fetching
		if (this._monitor._fetchingRecentItems) {
			if (debugPlaceholders) {
				console.log("[NoShiftGrid] Skipping cache clear during batch operation", {
					fetchingRecentItems: this._monitor._fetchingRecentItems,
					cachedWidth: this._cachedTileWidth,
				});
			}
			// Schedule a retry after the operation completes
			if (!this._cacheClearPending) {
				this._cacheClearPending = true;
				setTimeout(() => {
					this._cacheClearPending = false;
					// Only clear if we're still not in a batch operation
					if (!this._monitor._fetchingRecentItems) {
						this._clearTileWidthCache();
					}
				}, 100);
			}
			return;
		}

		if (debugPlaceholders && this._cachedTileWidth !== null) {
			console.log("[NoShiftGrid] Clearing tile width cache", {
				previousWidth: this._cachedTileWidth,
			});
		}
		this._cachedTileWidth = null;
	}

	/**
	 * Update the grid width from the container
	 * @private
	 */
	_updateGridWidth() {
		if (!this._gridContainer) return;

		const rect = this._gridContainer.getBoundingClientRect();
		const computedStyle = window.getComputedStyle(this._gridContainer);
		const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
		const paddingRight = parseFloat(computedStyle.paddingRight) || 0;

		const oldWidth = this._gridWidth;
		this._gridWidth = Math.floor(rect.width - paddingLeft - paddingRight);

		// Only log significant changes to reduce noise
		const debugPlaceholders = this._monitor._settings?.get("general.debugPlaceholders");
		if (debugPlaceholders && Math.abs(oldWidth - this._gridWidth) > 10) {
			console.log("[NoShiftGrid] Grid width changed significantly", {
				oldWidth: oldWidth,
				newWidth: this._gridWidth,
				difference: Math.abs(oldWidth - this._gridWidth),
				containerElement: this._gridContainer,
			});
		}
	}

	/**
	 * Reset the end placeholders count to 0
	 * This is called after fetch operations complete to prevent accumulation
	 */
	resetEndPlaceholdersCount() {
		const debugPlaceholders = this._monitor._settings?.get("general.debugPlaceholders");
		if (debugPlaceholders && this._endPlaceholdersCount > 0) {
			console.log("[NoShiftGrid] Reset end placeholders count", {
				oldCount: this._endPlaceholdersCount,
				newCount: 0,
			});
		}

		this._endPlaceholdersCount = 0;
	}

	/**
	 * Delete all placeholder tiles from the grid
	 */
	deletePlaceholderTiles() {
		//Delete all placeholder tiles
		const placeholderTiles = this._monitor._gridContainer.querySelectorAll(".vh-placeholder-tile");
		for (const placeholderTile of placeholderTiles) {
			placeholderTile.remove();
		}
	}

	/**
	 * Insert placeholder tiles to the grid to keep the grid elements fixed to their column with in sort TYPE_DATE_DESC
	 */
	insertPlaceholderTiles() {
		//If the sort is not by date DESC or the feed is paused, we don't need to do anything
		if (this._monitor._fetchingRecentItems) {
			return;
		}

		if (this._monitor._sortType != TYPE_DATE_DESC && this._monitor._sortType != TYPE_DATE_ASC) {
			return;
		}

		this.#lastInsertPlaceholderTilesTime = Date.now();

		//Delete all placeholder tiles
		this.deletePlaceholderTiles();

		if (!this._monitor._feedPaused) {
			this._visibleItemsCount = this._monitor.getTileCounter()?.getCount() || 0;
		}

		//Re-calculate the total number of items in the grid
		const theoricalItemsCount = this._visibleItemsCount + this._endPlaceholdersCount;
		const tileWidth = this._calculateTileWidth();

		//Calculate the number of tiles per row
		const tilesPerRow = Math.floor(this._gridWidth / tileWidth);

		//Caculate the number of placeholder tiles we need to insert
		const numPlaceholderTiles = (tilesPerRow - (theoricalItemsCount % tilesPerRow)) % tilesPerRow;

		const debugPlaceholders = this._monitor._settings?.get("general.debugPlaceholders");
		if (debugPlaceholders) {
			console.trace();
			console.log("[NoShiftGrid] InsertPlaceholderTiles", {
				numPlaceholderTiles,
				theoricalItemsCount,
				visibleItemsCount: this._visibleItemsCount,
				endPlaceholdersCount: this._endPlaceholdersCount,
				tilesPerRow,
				gridWidth: this._gridWidth,
				tileWidth,
			});
		}

		//Insert the placeholder tiles
		for (let i = 0; i < numPlaceholderTiles; i++) {
			const placeholderTile = document.createElement("div");
			placeholderTile.classList.add("vh-placeholder-tile");
			placeholderTile.classList.add("vvp-item-tile");
			placeholderTile.classList.add("vh-logo-vh");

			//Add the tile to the beginning of the grid
			this._monitor._gridContainer.insertBefore(
				placeholderTile.cloneNode(true),
				this._monitor._gridContainer.firstChild
			);
		}
	}

	/**
	 * Insert placeholder tiles at the end of the grid for removed items
	 * @param {number} count - Number of items that were removed
	 */
	insertEndPlaceholderTiles(count) {
		if (!this._gridContainer || count < 0) return;

		// Calculate how many tiles we need to complete the last row
		const tileWidth = this._calculateTileWidth();
		const tilesPerRow = Math.floor(this._gridWidth / tileWidth);

		// Update the end placeholders count
		this._endPlaceholdersCountBuffer = (this._endPlaceholdersCountBuffer + count) % tilesPerRow;

		const debugPlaceholders = this._monitor._settings?.get("general.debugPlaceholders");
		if (debugPlaceholders) {
			console.log("[NoShiftGrid] insertEndPlaceholderTiles", {
				oldEndPlaceholdersCount: this._endPlaceholdersCount,
				newEndPlaceholdersCount: this._endPlaceholdersCountBuffer,
				tilesPerRow,
			});
		}

		if (!this._monitor._feedPaused) {
			this._endPlaceholdersCount = this._endPlaceholdersCountBuffer;
		}
	}

	/**
	 * Calculate the width of a tile including margins
	 * @private
	 * @returns {number} The width of a tile in pixels
	 */
	_calculateTileWidth() {
		const debugPlaceholders = this._monitor._settings?.get("general.debugPlaceholders");
		const now = Date.now();

		// Don't calculate during atomic updates or while fetching
		if (this._monitor._fetchingRecentItems) {
			if (debugPlaceholders) {
				console.log("[NoShiftGrid] Skipping tile width calculation during batch operation", {
					fetchingRecentItems: this._monitor._fetchingRecentItems,
					cachedWidth: this._cachedTileWidth,
				});
			}
			// Always return cached value during batch operations
			// If we don't have one yet, we'll calculate it after the batch completes
			return this._cachedTileWidth || this._calculateInitialTileWidth();
		}

		// Check if we have a valid cached value
		// Cache never expires by time - only cleared on resize/zoom
		if (this._cachedTileWidth !== null && this._cachedTileWidth > 50) {
			if (debugPlaceholders) {
				console.log("[NoShiftGrid] Using cached tile width", {
					cachedWidth: this._cachedTileWidth,
					timestamp: now,
				});
			}
			return this._cachedTileWidth;
		}

		// Clear invalid cached values
		if (this._cachedTileWidth !== null && this._cachedTileWidth <= 50) {
			this._cachedTileWidth = null;
			this._tileWidthCacheTime = 0;
		}

		// Try to get tile width from CSS Grid
		const cssGridWidth = this._getTileWidthFromCSSGrid();
		if (cssGridWidth && cssGridWidth > 50) {
			// Cache any valid value
			this._cachedTileWidth = cssGridWidth;
			if (debugPlaceholders) {
				console.log("[NoShiftGrid] Calculated tile width from CSS Grid", {
					width: cssGridWidth,
					cached: true,
					timestamp: now,
				});
			}
			return cssGridWidth;
		}

		// Try to measure an actual tile or create a dummy one
		const measuredWidth = this._measureTileWidth();
		if (measuredWidth && measuredWidth > 50) {
			this._cachedTileWidth = measuredWidth;
			if (debugPlaceholders) {
				console.log("[NoShiftGrid] Measured tile width from DOM", {
					width: measuredWidth,
					cached: true,
					timestamp: now,
				});
			}
			return measuredWidth;
		}

		// If calculation failed and we have no cache, retry after a delay
		if (!this._cachedTileWidth && !this._retryPending) {
			this._retryPending = true;
			setTimeout(() => {
				this._retryPending = false;
				// Only retry if we still don't have a cached value and not in batch operation
				if (
					!this._cachedTileWidth &&
					!this._monitor._fetchingRecentItems &&
					this._monitor._sortType == TYPE_DATE_DESC
				) {
					if (debugPlaceholders) {
						console.log("[NoShiftGrid] Retrying tile width calculation");
					}
					this.insertPlaceholderTiles();
				}
			}, 100);
		}

		// If we still don't have a width, use the initial calculation method
		const initialWidth = this._calculateInitialTileWidth();
		this._cachedTileWidth = initialWidth;

		if (debugPlaceholders) {
			console.log("[NoShiftGrid] Using initial tile width calculation", {
				width: initialWidth,
				timestamp: now,
			});
		}

		return initialWidth;
	}

	/**
	 * Calculate initial tile width using settings
	 * This is only used when we have no cached value and can't calculate from DOM
	 * @private
	 * @returns {number} The initial tile width
	 */
	_calculateInitialTileWidth() {
		// Use settings as the most reliable initial source
		const settingWidth = parseInt(this._monitor._settings?.get("general.tileSize.width") || "236");
		return settingWidth + 1; // Add 1px for margin
	}

	/**
	 * Get tile width from CSS Grid template
	 * @private
	 * @returns {number|null} The tile width or null if not found
	 */
	_getTileWidthFromCSSGrid() {
		if (!this._gridContainer) return null;

		// First, try to get width from an actual tile if one exists
		// This is more reliable than parsing CSS Grid template
		const existingTile = this._gridContainer.querySelector(".vvp-item-tile:not(.vh-placeholder-tile)");
		if (existingTile) {
			const rect = existingTile.getBoundingClientRect();
			if (rect.width > 50) {
				const computedStyle = window.getComputedStyle(existingTile);
				const marginLeft = parseFloat(computedStyle.marginLeft) || 0;
				const marginRight = parseFloat(computedStyle.marginRight) || 0;
				return rect.width + marginLeft + marginRight;
			}
		}

		const computedStyle = window.getComputedStyle(this._gridContainer);
		const gridTemplateColumns = computedStyle.gridTemplateColumns;

		if (!gridTemplateColumns || gridTemplateColumns === "none") {
			return null;
		}

		// Parse different grid template patterns
		// Examples:
		// - "repeat(auto-fill, minmax(236px, auto))"
		// - "199.141px 199.141px 199.141px 199.141px"
		// - "1fr 1fr 1fr"

		// Try to extract from repeat() with minmax
		const repeatMatch = gridTemplateColumns.match(/repeat\([^,]+,\s*minmax\((\d+(?:\.\d+)?)px/);
		if (repeatMatch) {
			return parseFloat(repeatMatch[1]);
		}

		// Try to extract from explicit pixel values
		const pixelMatch = gridTemplateColumns.match(/(\d+(?:\.\d+)?)px/);
		if (pixelMatch) {
			return parseFloat(pixelMatch[1]);
		}

		// If we have equal fr units, calculate based on grid width
		const frMatches = gridTemplateColumns.match(/(\d+(?:\.\d+)?)fr/g);
		if (frMatches && frMatches.length > 0) {
			// All fr values should be equal for a uniform grid
			const frCount = frMatches.length;
			return this._gridWidth / frCount;
		}

		return null;
	}

	/**
	 * Measure tile width by creating or finding a tile
	 * @private
	 * @returns {number|null} The measured width or null if failed
	 */
	_measureTileWidth() {
		// First try to find an existing tile
		let tile = this._gridContainer.querySelector(".vvp-item-tile:not(.vh-placeholder-tile)");
		let createdDummy = false;

		// If no tile exists, create a dummy one
		if (!tile) {
			tile = document.createElement("div");
			tile.className = "vvp-item-tile";
			tile.style.visibility = "hidden";
			tile.style.position = "absolute";

			this._gridContainer.appendChild(tile);
			createdDummy = true;

			// Force layout
			void tile.offsetHeight;
		}

		let width = null;

		try {
			// Get computed style
			const computedStyle = window.getComputedStyle(tile);

			// Try different measurement methods
			const rect = tile.getBoundingClientRect();
			const marginLeft = parseFloat(computedStyle.marginLeft) || 0;
			const marginRight = parseFloat(computedStyle.marginRight) || 0;

			// Method 1: getBoundingClientRect
			if (rect.width > 0) {
				width = rect.width + marginLeft + marginRight;
			}
			// Method 2: offsetWidth (for CSS Grid items with negative margins)
			else if (tile.offsetWidth > 0) {
				width = tile.offsetWidth + marginLeft + marginRight;
			}
			// Method 3: Check CSS width property
			else if (computedStyle.width && computedStyle.width !== "auto") {
				const cssWidth = parseFloat(computedStyle.width);
				if (cssWidth > 0) {
					width = cssWidth + marginLeft + marginRight;
				}
			}
		} finally {
			// Clean up dummy tile
			if (createdDummy && tile.parentNode) {
				tile.remove();
			}
		}

		return width;
	}
}

export { NoShiftGrid };
