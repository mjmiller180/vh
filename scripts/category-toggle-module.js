// Last compiled at 2026-11-04_2317
// Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved.
// https://toolsmyths.com
// SPDX-License-Identifier: LicenseRef-Proprietary
/**
 * VineTools - Category Toggle Button Module
 * Replaces hover-based collapse with button toggle
 * @version 1.0
 */

(function() {
  'use strict';
  
  // Configuration
  const CONFIG = {
    containerId: 'vvp-browse-nodes-container',
    buttonId: 'category-toggle-btn',
    storageKey: 'vineCategories_collapsed',
    retryDelay: 500,
    maxRetries: 10
  };
  
  let retryCount = 0;
  
  /**
   * Creates and adds the toggle button to the category container
   */
  function createToggleButton(container) {
    // Prevent duplicate buttons
    if (document.getElementById(CONFIG.buttonId)) {
      console.log('[Category Toggle] Button already exists');
      return;
    }
    
    const toggleBtn = document.createElement('button');
    toggleBtn.id = CONFIG.buttonId;
    toggleBtn.className = 'vine-category-toggle';
    toggleBtn.setAttribute('aria-label', 'Toggle category list');
    toggleBtn.textContent = 'Collapse';
    
    // Add button to container
    container.appendChild(toggleBtn);
    
    // Restore saved state
    restoreState(container, toggleBtn);
    
    // Add event listener
    toggleBtn.addEventListener('click', () => handleToggle(container, toggleBtn));
    
    console.log('[Category Toggle] Button initialized successfully');
  }
  
  /**
   * Restores the saved collapsed/expanded state
   */
  function restoreState(container, button) {
    try {
      const savedState = localStorage.getItem(CONFIG.storageKey);
      if (savedState === 'true') {
        container.classList.add('collapsed');
        button.textContent = 'Expand';
        button.setAttribute('aria-expanded', 'false');
      } else {
        button.setAttribute('aria-expanded', 'true');
      }
    } catch (error) {
      console.error('[Category Toggle] Error restoring state:', error);
    }
  }
  
  /**
   * Handles the toggle button click
   */
  function handleToggle(container, button) {
    const isCollapsed = container.classList.toggle('collapsed');
    
    if (isCollapsed) {
      button.textContent = 'Expand';
      button.setAttribute('aria-expanded', 'false');
      saveState(true);
    } else {
      button.textContent = 'Collapse';
      button.setAttribute('aria-expanded', 'true');
      saveState(false);
    }
  }
  
  /**
   * Saves the current state to localStorage
   */
  function saveState(isCollapsed) {
    try {
      localStorage.setItem(CONFIG.storageKey, isCollapsed.toString());
    } catch (error) {
      console.error('[Category Toggle] Error saving state:', error);
    }
  }
  
  /**
   * Initializes the category toggle functionality
   */
  function initialize() {
    const container = document.getElementById(CONFIG.containerId);
    
    if (!container) {
      retryCount++;
      if (retryCount < CONFIG.maxRetries) {
        console.log(`[Category Toggle] Container not found, retrying (${retryCount}/${CONFIG.maxRetries})...`);
        setTimeout(initialize, CONFIG.retryDelay);
      } else {
        console.warn('[Category Toggle] Container not found after max retries');
      }
      return;
    }
    
    createToggleButton(container);
  }
  
  /**
   * Entry point - wait for DOM ready
   */
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initialize);
    } else {
      initialize();
    }
  }
  
  // Start initialization
  init();
  
  // Export for potential external use
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initialize };
  }
  
})();
