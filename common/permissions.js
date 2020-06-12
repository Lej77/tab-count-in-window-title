'use strict';

import {
  EventListener,
  EventManager
} from '../common/events.js';

import {
  PromiseWrapper
} from '../common/delays.js';


/**
 * Request a permission using the extension's browser action or page action.
 *
 * @class ToolbarPermissionRequest
 */
export class ToolbarPermissionRequest {
  /**
   * Creates an instance of ToolbarPermissionRequest.
   *
   * @param {Object} permission The permission to request. False values will cancel the current request.
   * @param {any} [pageActionTabId=null] Provide a tabId to use pageAction instead of browserAction.
   * @memberof ToolbarPermissionRequest
   */
  constructor(permission, pageActionTabId = null) {
    this._permission = permission;
    this._pageActionTabId = pageActionTabId;

    this._clickListener = null;
    this._isDisposed = false;
    this._onDisposed = new EventManager();
    this._promiseWrapper = new PromiseWrapper();

    this.start = this._start();
  }

  async _start() {
    await this._abortPrevious();
    this.done = this._handleCompleted();
    this.start = this._makeRequest();
  }

  async _abortPrevious() {
    while (ToolbarPermissionRequest.lastRequest) {
      const currentRequest = ToolbarPermissionRequest.lastRequest;
      currentRequest.dispose();
      try {
        await currentRequest.done;
      } catch (error) { }
      if (currentRequest === ToolbarPermissionRequest.lastRequest) {
        ToolbarPermissionRequest.lastRequest = null;
      }
    }
    ToolbarPermissionRequest.lastRequest = this;
  }

  async _handleCompleted() {
    let waitError = null;
    try {
      await this._promiseWrapper.getValue();
    } catch (error) { waitError = error; }
    this.dispose();
    try {
      if (this.useBrowserAction) {
        await browser.browserAction.setBadgeText({ text: '' });
        await browser.browserAction.setPopup({ popup: null });
      } else {
        await browser.pageAction.hide(this._pageActionTabId);
      }
    } finally {
      if (this === ToolbarPermissionRequest.lastRequest) {
        ToolbarPermissionRequest.lastRequest = null;
      }
    }
    if (waitError) {
      throw waitError;
    }
    return true;
  }

  async _makeRequest() {
    try {
      if (!this._permission) {
        this.dispose();
        return;
      }
      /** @type {(function(): Promise)[]} */
      let actions;
      if (this.useBrowserAction) {
        actions = [
          () => browser.browserAction.setPopup({ popup: '' }),
          () => browser.browserAction.setBadgeText({ text: '!' }),
        ];
      } else {
        actions = [
          () => browser.pageAction.show(this._pageActionTabId),
        ];
      }

      for (const action of actions) {
        if (this.isDisposed)
          break;
        await action();
      }
      if (!this.isDisposed) {
        if (this.useBrowserAction) {
          this._clickListener = new EventListener(browser.browserAction.onClicked, (tab) => this._handleClick());
        } else {
          this._clickListener = new EventListener(browser.pageAction.onClicked, (tab) => this._handleClick());
        }
      }
    } catch (error) {
      this._promiseWrapper.reject(error);
    }
  }


  async _handleClick() {
    if (this.isDisposed) {
      return;
    }
    try {
      await browser.permissions.request(this._permission);
      this._promiseWrapper.resolve(true);
    } catch (error) {
      this._promiseWrapper.reject(error);
    }
  }


  // #region Dispose

  dispose() {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    if (this._clickListener) {
      this._clickListener.dispose();
      this._clickListener = null;
    }
    if (!this._permission) {
      this._promiseWrapper.resolve(false);
    } else {
      this._promiseWrapper.reject(new Error('Request canceled.'));
    }
    this._onDisposed.fire(this);
  }

  get isDisposed() {
    return this._isDisposed;
  }

  get onDisposed() {
    return this._onDisposed.subscriber;
  }

  // #endregion Dispose

  /**
   * A promise that will be resolved with true if the permission is changed, false if the permission isn't changed or rejected if the request is canceled.
   *
   * @readonly
   * @memberof ToolbarPermissionRequest
   */
  get result() {
    return this._promiseWrapper.promise;
  }
  get useBrowserAction() {
    return !this._pageActionTabId && this._pageActionTabId !== 0;
  }
  get isWaitingForUserInput() {
    return Boolean(this._clickListener);
  }
}
/** @type {ToolbarPermissionRequest | null} */
ToolbarPermissionRequest.lastRequest = null;