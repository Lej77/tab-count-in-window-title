


class RuntimeHandler {
  constructor() {
    this.messageListener = new EventListener(browser.runtime.onMessage,
      (
        message,      // object. The message itself. This is a JSON-ifiable object.
        sender,       // A runtime.MessageSender object representing the sender of the message.
        sendResponse  // A function to call, at most once, to send a response to the message. The function takes a single argument, which may be any JSON-ifiable object. This argument is passed back to the message sender.
      ) => {
        if (!message || !message.type || "string" !== typeof message.type) {
          return;
        }

        switch (message.type) {
          case "clearPrefix": {
            TabCounter.clearWindowPrefixes();
          } break;
        }
      });
    this.installListener = new EventListener(browser.runtime.onInstalled,
      ({
        id,               // string. The ID of the imported shared module extension that updated. This is present only if the reason value is shared_module_update
        previousVersion,  // string. The previous version of the extension just updated. This is only present if the reason value is update.
        reason,           // An runtime.OnInstalledReason value, stating the reason that this event is being dispatched. Values: "install", "update", "browser_update", "shared_module_update".
        temporary,        // boolean. True if the add-on was installed temporarily. For example, using the "about:debugging" page in Firefox or using web-ext run. False otherwise.
      }) => {

      }
    );
  }


  close() {
    closeListener(messageListener);
    closeListener(installListener);
  }
  closeListener(listener) {
    if (listener && listener instanceof EventListener) {
      listener.close();
      for (let k of Object.keys(this)) {
        if (this[k] === listener) {
          this[k] = null;
          break;
        }
      }
    }
  }
  get isDisposed() {
    for (let key of Object.keys(this)) {
      if (this[key] && this[key] instanceof EventListener) {
        return false;
      }
    }
    return true;
  }
}



class BackgroundWorker {
  constructor() {
    this.runtimeHandler = new RuntimeHandler();
  }


  stop() {
    if (this.runtimeHandler) {
      this.runtimeHandler.close();
      this.runtimeHandler = null;
    }
  }
  get isDisposed() {
    return !Boolean(this.runtimeHandler);
  }
}



new BackgroundWorker();




const tabCountRegExp = new RegExp("%TabCount%", "ig");

class TabCounter {
  constructor(settings) {
    this.settings = settings;

    this.tabCountRequestManager = new RequestManager((sourceId, requestInfo) => {
      this.updateWindowTabCount(sourceId, requestInfo);
      return settings.timeBetweenUpdatesInMilliseconds;
    });
    let requestNewUpdate = (winodwId, operationInfo) => {
      this.tabCountRequestManager.newRequest(winodwId, operationInfo ? operationInfo : {});
    }

    let createListener = new EventListener(browser.tabs.onCreated, (tab) => requestNewUpdate(tab.windowId));
    let removeListener = new EventListener(browser.tabs.onRemoved, (tabId, removeInfo) => requestNewUpdate(removeInfo.windowId, { tabId: tabId, tabRemoved: true }));
    let attachedListener = new EventListener(browser.tabs.onAttached, ((tabId, attachInfo) => requestNewUpdate(attachInfo.newWindowId)));
    let detachedListener = new EventListener(browser.tabs.onDetached, ((tabId, detachInfo) => requestNewUpdate(detachInfo.oldWindowId)));

    this.stop = () => {
      createListener.close();
      removeListener.close();
      attachedListener.close();
      detachedListener.close();
    };

    this.updateWindowTabCount();
  }

  forceUpdate() {
    let manager = this.tabCountRequestManager;
    for (let windowBlock of manager.blockedSources) {
      manager.grantSource(windowBlock);
    }
  }


  async updateWindowTabCount(windowId = null, operationInfo = {}) {
    if (windowId || windowId === 0) {
      let tabs = await browser.tabs.query({ windowId: windowId });
      let tabCount = tabs.length;

      try {
        if (operationInfo && operationInfo.tabRemoved && operationInfo.tabId && tabs.map(tab => tab.id).indexOf(operationInfo.tabId) >= 0) {
          // If the removed tab was selected when it was closed then it will still be in the provided tab list.
          tabCount--;
        }
      } catch (err) { }

      if (tabCount < 1)
        tabCount = 1;

      this.formatWindowPrefix(windowId, tabCount);
    } else {
      let windows = await browser.windows.getAll({ populate: true });
      for (let window of windows) {
        this.formatWindowPrefix(window.id, window.tabs.length);
      }
    }
  }

  async formatWindowPrefix(windowId, tabCount) {
    await TabCounter.setWindowPrefix(windowId, this.settings.windowPrefixFormat.replace(tabCountRegExp, tabCount + ""));
  }

  static async clearWindowPrefixes() {
    let clear = async (windowId) => {
      await TabCounter.setWindowPrefix(windowId, ' ');
      await TabCounter.setWindowPrefix(windowId, '');
    }
    let promises = [];
    for (let window of await browser.windows.getAll()) {
      promises.push(clear(window.id));
    }
    for (let promise of promises) {
      await promise;
    }
  }

  static async setWindowPrefix(windowId, prefix) {
    return await browser.windows.update(windowId, { titlePreface: prefix });
  }
}

var tabCounter;
let startTabCounter = async () => {
  await settingsTracker.start;
  if (!tabCounter && settingsTracker.settings.isEnabled) {
    tabCounter = new TabCounter(settingsTracker.settings);
  }
}

var settingsTracker = new SettingsTracker(null, (changes, storageArea) => {
  
  if (changes.isEnabled) {
    if (changes.isEnabled.newValue) {
      startTabCounter();
    } else {
      tabCounter.stop();
      tabCounter = null;
    }
  }

  if (!settingsTracker.settings.isEnabled || !tabCounter) {
    return;
  }

  if (changes.windowPrefixFormat) {
    let newValue = changes.windowPrefixFormat.newValue;
    if (!newValue || newValue === "" || typeof newValue !== "string") {
      TabCounter.clearWindowPrefixes();
    } else {
      tabCounter.updateWindowTabCount();
    }
  }
  if (changes.timeBetweenUpdatesInMilliseconds !== undefined) {
    // Ensure that new block times are used:
    tabCounter.forceUpdate();
  }
});


startTabCounter();
