import { Logger } from "/scripts/core/utils/Logger.js";
var logger = new Logger();

import { Tile } from "/scripts/ui/components/Tile.js";

class Grid {
	#gridDOM;
	#pArrTile;
	#page;
	#id;

	/**
	 * Generate a new Grid instance.
	 * A Grid is attached to a Page instance (parent) and contains a collection of Tile instances (children)
	 * @param {string} id
	 * @param {HTMLElement} gridDOM
	 * @param {Page} pageInstance
	 */
	constructor(id, gridDOM, pageInstance) {
		this.#id = id;
		this.#pArrTile = [];
		this.#gridDOM = gridDOM;
		this.#page = pageInstance;
	}

	/**
	 * Get the DOM's ID of the Grid's HTMLElement
	 * @returns {string}
	 */
	getId() {
		return this.#id;
	}

	/**
	 * Get the Grid's HTMLElement
	 * @returns {HTMLElement}
	 */
	getDOM() {
		return this.#gridDOM;
	}

	/**
	 * Get the Page instance that the Grid is attached to
	 * @returns {Page}
	 */
	getPage() {
		return this.#page;
	}

	/**
	 * Generate and add a Tile instance to the Grid
	 * @param {HTMLElement} tileDOM
	 * @returns {Tile}
	 */
	addTile(tile) {
		try {
			const asin = tile.getAsin();
			const tileDOM = tile.getDOM();

			this.#pArrTile[asin] = tile;

			//Detach the element from the current parent
			if (tileDOM && tileDOM.parentNode) {
				tileDOM.parentNode.removeChild(tileDOM);
			}
			//Append the element to the grid
			const gridElement = this.getDOM();
			if (gridElement) {
				gridElement.appendChild(tileDOM);
				tileDOM.style.display = "";
			}

			return tile;
		} catch (e) {
			logger.add("Error in addTile: " + e.message);
		}
	}

	/**
	 * Remove a Tile instance from the Grid
	 * @param {Tile} t
	 * @returns {boolean}
	 */
	removeTile(t) {
		const asin = t.getAsin();

		// Iterate over the array in reverse order to safely remove items
		let removed = false;
		if (this.#pArrTile[asin]) {
			delete this.#pArrTile[asin];
			removed = true;
		}
		return removed;
	}

	/**
	 * Remove a Tile instance from the Grid and animate it out
	 * @param {Tile} t
	 * @returns {void}
	 */
	async removeTileAnimate(t) {
		this.removeTile(t);

		await t.animateVanish(); //Will hide the tile
	}

	/**
	 * Get the number of Tile instances in the Grid
	 * @param {boolean} trueCount True, will calculate the number of actual HTML tiles in the DOM. False to rely on the stored array.
	 * @returns {number}
	 */
	getTileCount(trueCount = false) {
		if (trueCount) {
			// Count only actual tiles, excluding placeholders
			if (!this.#gridDOM) return 0;

			let count = 0;
			let placeholderCount = 0;
			for (const child of this.#gridDOM.children) {
				// Skip placeholder tiles
				if (!child.classList.contains("vh-placeholder-tile")) {
					count++;
				} else {
					placeholderCount++;
				}
			}

			return count;
		} else {
			return this.#pArrTile.length;
		}
	}

	/**
	 * Get a Tile instance by its ASIN
	 * @param {string} asin
	 * @returns {Tile}
	 */
	getTileByASIN(asin) {
		return this.#pArrTile[asin];
	}

	/**
	 * Get all Tile instances in the Grid
	 * @returns {Tile[]}
	 */
	getAllTiles() {
		return this.#pArrTile;
	}
}

export { Grid };
