
class WindowWrapperCollection {
  constructor(blockTime, titleFormat, windowFilter) {
    this.array = [];

    var onTabCountChange = new EventManager();
    this.onTabCountChange = onTabCountChange.subscriber;  // Total tab count changed. Arg: [window wrapper that changed tab count]


    // #region Block Time in milliseconds

    var getBlockTime = () => blockTime;
    var setBlockTime = (value) => {
      if (value === blockTime) {
        return;
      }
      blockTime = value;

      // Ensure that new block time is used:
      for (let wrapper of this.array) {
        wrapper.unblockTabUpdate();
        wrapper.unblockTitleUpdate();
      }
    };
    defineProperty(this, 'blockTime', getBlockTime, setBlockTime);

    // #endregion Block Time in milliseconds


    // #region Window Filter

    let getWindowFilter = () => {
      if (windowFilter && typeof windowFilter === 'function') {
        return windowFilter;
      }
      return (wrapper) => {
        return true;
      };
    };
    let setWindowFilter = (value) => {
      if (windowFilter === value) {
        return;
      }
      let oldAllowedWrappers = this.filteredWindowWrappers;

      windowFilter = value;

      let newAllowedWrappers = this.filteredWindowWrappers;


      this.updateWindowTitles();
    };
    defineProperty(this, 'windowFilter', getWindowFilter, setWindowFilter);

    // #endregion Window Filter


    // #region Title Format

    var cachedFormatInfo = null;
    var getFormatInfo = () => {
      if (!cachedFormatInfo) {
        let formatIsString = titleFormat && typeof titleFormat === 'string';
        cachedFormatInfo = {
          useTotalTabCount: formatIsString && titleFormat.search(totalTabCountRegExp) >= 0,
          useTabCount: formatIsString && titleFormat.search(tabCountRegExp) >= 0,
        };
      }
      return cachedFormatInfo;
    };
    defineProperty(this, 'formatInfo', getFormatInfo);

    var getTitleFormat = () => titleFormat;
    var setTitleFormat = (value) => {
      if (!value || typeof value !== 'string') {
        value = '';
      }
      if (value === titleFormat) {
        return;
      }

      cachedFormatInfo = null;
      titleFormat = value;

      this.updateWindowTitles();

      if (isStarted) {
        startNeededListeners();
      }
    };
    setTitleFormat(titleFormat);
    defineProperty(this, 'titleFormat', getTitleFormat, setTitleFormat);

    // #endregion Title Format


    // #region Listeners

    var startNeededListeners = () => {
      isStarted = true;
      let info = this.formatInfo;
      let trackTabs = info.useTabCount || info.useTotalTabCount;
      if (trackTabs) {
        startTabAddRemoveListeners();
      } else {
        if (tabAddRemoveListeners) {
          tabAddRemoveListeners.dispose();
        }
      }
      if (!titleFormat || titleFormat === '') {
        if (windowListeners) {
          windowListeners.dispose();
          WindowWrapper.clearWindowPrefixes();
        }
      } else {
        startWindowListeners();
      }
    };


    var disposables = new DisposableCollection([
      new EventListener(onTabCountChange, (wrapper) => handleEvent(() => {
        let affectedWrappers = [wrapper];
        if (this.formatInfo.useTotalTabCount) {
          affectedWrappers.push.apply(affectedWrappers, this.array);
        }
        if (affectedWrappers.length > 0) {
          this.updateWindowTitles(affectedWrappers);
        }
      })),
    ]);

    var tabAddRemoveListeners = null;
    var startTabAddRemoveListeners = () => {
      if (tabAddRemoveListeners) {
        return;
      }

      startWindowListeners();

      let getWrapperAndDo = (windowId, callback) => {
        let wrapper = this.getWindowWrappersById(windowId);
        if (wrapper) {
          return callback(wrapper);
        }
      };
      let listeners = new DisposableCollection([
        new EventListener(browser.tabs.onCreated, (tab) => handleEvent(() => {
          getWrapperAndDo(tab.windowId, (wrapper) => wrapper.tabAdded(tab.id));
        })),
        new EventListener(browser.tabs.onRemoved, (tabId, removeInfo) => handleEvent(() => {
          getWrapperAndDo(removeInfo.windowId, (wrapper) => wrapper.tabRemoved(tabId));
        })),

        new EventListener(browser.tabs.onAttached, (tabId, attachInfo) => handleEvent(() => {
          getWrapperAndDo(attachInfo.newWindowId, (wrapper) => wrapper.tabAdded(tabId));
        })),
        new EventListener(browser.tabs.onDetached, (tabId, detachInfo) => handleEvent(() => {
          getWrapperAndDo(detachInfo.oldWindowId, (wrapper) => wrapper.tabRemoved(tabId));
        })),
      ]);
      disposables.trackDisposables(listeners);

      new EventListener(listeners.onDisposed, () => {
        if (listeners === tabAddRemoveListeners) {
          tabAddRemoveListeners = null;
        }
        disposables.untrackDisposables(listeners);
      });
      tabAddRemoveListeners = listeners;

      for (let wrapper of this.array) {
        wrapper.forceTabUpdate();
      }
    };
    defineProperty(this, 'isTrackingTabCount', () => Boolean(tabAddRemoveListeners));

    var windowListeners = null;
    var startWindowListeners = () => {
      if (windowListeners) {
        return;
      }

      let listeners = new DisposableCollection([
        new EventListener(browser.windows.onCreated, (window) => handleEvent(() => {
          this.addWindowWrappers(new WindowWrapper(window, getBlockTime));
        })),
        new EventListener(browser.windows.onRemoved, (windowId) => handleEvent(() => {
          this.removeWindowWrappers(this.getWindowWrappersById(windowId));
        })),
      ]);
      disposables.trackDisposables(listeners);

      new EventListener(listeners.onDisposed, () => {
        if (windowListeners === listeners) {
          windowListeners = null;
        }
        disposables.untrackDisposables(listeners);
        this.removeWindowWrappers(this.array);

        if (tabAddRemoveListeners) {
          // Can't track tabs without tracking windows:
          tabAddRemoveListeners.dispose();
        }
      });
      windowListeners = listeners;

      start();
    };
    defineProperty(this, 'isTrackingWindows', () => Boolean(windowListeners));

    // #endregion Listeners


    // #region Wrapper Add/Remove

    this.addWindowWrappers = (windowWrappers) => {
      if (!windowWrappers) {
        return;
      }
      if (!Array.isArray(windowWrappers)) {
        windowWrappers = [windowWrappers];
      }
      let ids = this.array.map(wrapper => wrapper.window.id);
      for (let wrapper of windowWrappers) {
        if (ids.includes(wrapper.window.id)) {
          continue;
        }
        this.array.push(wrapper);
        ids.push(wrapper.window.id);

        // Wrapper event listeners:
        let wrapperListeners = new DisposableCollection([
          new EventListener(wrapper.onTabCountChange, () => {
            onTabCountChange.fire(wrapper);
          }),
        ]);
        new EventListener(wrapper.onDisposed, () => {
          wrapperListeners.dispose();
        });
        onTabCountChange.fire(wrapper);
      }
    };

    this.removeWindowWrappers = (windowWrappers) => {
      if (!windowWrappers) {
        return;
      }
      if (!Array.isArray(windowWrappers)) {
        windowWrappers = [windowWrappers];
      }
      for (let wrapper of windowWrappers) {
        if (this.array.includes(wrapper)) {
          wrapper.dispose();
          this.array = this.array.filter(arrayWrapper => arrayWrapper !== wrapper);
          onTabCountChange.fire(wrapper);
        }
      }
    };

    // #endregion Wrapper Add/Remove


    // #region Start & Stop

    var queuedCallbacks = [];
    var isStarted = false;
    var isDisposed = false;
    var handleEvent = (callback) => {
      if (isDisposed) {
        return;
      }
      if (isStarted) {
        callback();
      } else {
        queuedCallbacks.push(callback);
      }
    };

    var start = () => {
      startWindowListeners();
      this.start = _start();
    };
    var _start = async () => {
      if (isDisposed) {
        return;
      }

      isStarted = false;
      let windows = await browser.windows.getAll({ populate: true });

      this.addWindowWrappers(windows.map(window => new WindowWrapper(window, getBlockTime)));

      for (let callback of queuedCallbacks) {
        if (isDisposed) {
          break;
        }
        callback();
      }
      queuedCallbacks = [];
      isStarted = true;
    };

    this.stop = () => {
      if (isDisposed) {
        return;
      }
      disposables.dispose();
      this.removeWindowWrappers(this.array);
      isDisposed = true;
    };

    defineProperty(this, 'isDisposed', () => isDisposed);
    defineProperty(this, 'isStarted', () => isStarted);

    // #endregion Start & Stop

    startNeededListeners();
  }

  getWindowWrappersById(windowIds) {
    if (!windowIds && windowIds !== 0) {
      return;
    }
    let oneValue = false;
    if (!Array.isArray(windowIds)) {
      windowIds = [windowIds];
      oneValue = true;
    }
    let wrappers = [];
    for (let windowId of windowIds) {
      let possible = this.array.filter(wrapper => wrapper.window.id === windowId);
      if (possible.length === 0) {
        wrappers.push(null);
      } else {
        wrappers.push(possible[0]);
      }
    }
    if (oneValue) {
      return wrappers[0];
    } else {
      return wrappers;
    }
  }

  updateWindowTitles(windowWrappers = null) {
    if (this.isDisposed) {
      return;
    }
    if (!windowWrappers) {
      windowWrappers = this.array;
    }
    if (!Array.isArray(windowWrappers)) {
      windowWrappers = [windowWrappers];
    }

    let format = this.titleFormat;
    let cachedTotalTabCount = '';
    if (this.formatInfo.useTotalTabCount) {
      cachedTotalTabCount = this.totalTabCount;
    }

    let allowed = this.filteredWindowWrappers;
    let updated = [];
    for (let wrapper of windowWrappers) {
      if (!this.array.includes(wrapper) || updated.includes(wrapper)) {
        continue;
      }
      updated.push(wrapper);

      if (!allowed.includes(wrapper)) {
        wrapper.clearPrefix();
        continue;
      }

      wrapper.setTitlePrefix(
        format
          .replace(tabCountRegExp, wrapper.tabCount)
          .replace(totalTabCountRegExp, cachedTotalTabCount)
      );
    }
  }

  get filteredWindowWrappers() {
    return this.array.filter(wrapper => this.windowFilter(wrapper));
  }

  get totalTabCount() {
    let tabCount = 0;
    for (let windowWrapper of this.filteredWindowWrappers) {
      tabCount += windowWrapper.tabCount;
    }
    return tabCount;
  }
}



class WindowWrapper {
  constructor(window, blockTime) {
    var ignoredTabIds = [];
    var onTabUpdate = new EventManager();
    var onTabCountChange = new EventManager();
    let onDisposed = new EventManager();
    let disposed = false;
    let lastTitlePrefix = '';


    // #region Tab Count

    var updateTabs = async (windowTabs = null) => {
      if (getDisposed()) {
        return;
      }
      // Get copy of array since it might change while waiting for tabs.
      let ignoredIds = ignoredTabIds.slice();

      if (!windowTabs || !Array.isArray(windowTabs)) {
        windowTabs = await browser.tabs.query({ windowId: window.id });
      }
      let oldTabCount = getTabCount();
      window.tabs = windowTabs.filter(tab => !ignoredTabIds.includes(tab.id));

      let newIgnoredIds = ignoredTabIds.filter(id => !ignoredIds.includes(id));
      let tabListIds = windowTabs.map(tab => tab.id);
      ignoredTabIds = ignoredIds.filter(id => tabListIds.includes(id)); // Only keep ignoring tab ids that are still in use.
      ignoredTabIds.push.apply(ignoredTabIds, newIgnoredIds);           // Add tab ids that started being ignored after tab query.

      let newTabCount = getTabCount();
      onTabUpdate.fire(this);
      if (oldTabCount !== newTabCount) {
        onTabCountChange.fire(this, oldTabCount, newTabCount);
      }
    };

    var updateManager = new RequestManager(
      async () => {
        await updateTabs();
      },
      blockTime,
      false,
    );

    var getTabCount = () => {
      let tabCount = 1;
      if (window && window.tabs && Array.isArray(window.tabs)) {
        tabCount = window.tabs.length;
      }

      if (tabCount < 1)
        tabCount = 1;

      return tabCount;
    };
    var tabAdded = (tabId) => {
      if (getDisposed()) {
        return;
      }
      ignoredTabIds = ignoredTabIds.filter(tId => tId !== tabId);
      updateManager.invalidate();
    };
    var tabRemoved = (tabId) => {
      if (getDisposed()) {
        return;
      }
      ignoredTabIds.push(tabId);
      updateManager.invalidate();
    };

    // #endregion Tab Count


    var getDisposed = () => {
      return disposed;
    };
    var dispose = () => {
      if (getDisposed()) {
        return;
      }
      disposed = true;
      updateManager.dispose();
      onDisposed.fire(this);
    };


    // #region Title

    let titleUpdateManager = new RequestManager(
      async (value) => {
        if (lastTitlePrefix === value) {
          return;
        }
        if (!value || value === '') {
          await clearPrefix();
        } else {
          await WindowWrapper.setWindowPrefix(window.id, value);
          lastTitlePrefix = value;
        }
      },
      blockTime,
      false,
    );

    let clearPrefix = async () => {
      await WindowWrapper.clearWindowPrefixes(window.id);
      lastTitlePrefix = '';
    };
    let getLastPrefix = () => {
      return lastTitlePrefix;
    };
    let getPrefix = async () => {
      if (!window) {
        // No window.
        return null;
      }
      // Title should be: "[prefix][tab title] - [brand]" 
      // or if the tab has no title: "[brand]"
      let title = window.title;
      if (!title && title !== '') {
        // No window title property. Needs 'tabs' permission.
        return null;
      }

      // Remove brand from title:
      let separatorIndex = title.lastIndexOf(' - ');
      if (separatorIndex < 0) {
        // Current tab has no title and title prefix is therefore not shown.
        return null;
      } else {
        title = title.substr(0, separatorIndex);
      }

      // Remove tab title from window title:
      let currentTab = await browser.tabs.query({ windowId: window.id, active: true })[0];
      if (currentTab.title && currentTab.title !== '') {
        let tabTitleIndex = title.lastIndexOf(currentTab.title);
        if (tabTitleIndex >= 0) {
          title = title.substr(0, tabTitleIndex);
        }
      }

      return title;
    };
    let setPrefix = async (value) => {
      titleUpdateManager.invalidate(value);
    };

    // #endregion Title


    if (!window.tabs) {
      updateManager.invalidate();
    }

    Object.assign(this, {
      tabAdded: tabAdded,
      tabRemoved: tabRemoved,
      dispose: dispose,

      clearPrefix: () => titleUpdateManager.forceUpdate(''),
      getTitlePrefix: getPrefix,
      setTitlePrefix: setPrefix,

      forceTabUpdate: () => updateManager.forceUpdate(),
      unblockTabUpdate: () => updateManager.unblock(),
      unblockTitleUpdate: () => titleUpdateManager.unblock(),

      onTabUpdate: onTabUpdate.subscriber,
      onTabCountChange: onTabCountChange.subscriber,
      onDisposed: onDisposed.subscriber,
    });

    defineProperty(this, 'lastTitlePrefix', getLastPrefix, (value) => { lastTitlePrefix = value; });
    defineProperty(this, 'window', () => window, (value) => { window = value; });
    defineProperty(this, 'isDisposed', getDisposed);
    defineProperty(this, 'tabCount', getTabCount);
  }

  static async clearWindowPrefixes(windowIds = null) {
    if (!windowIds && windowIds !== 0) {
      let windows = await browser.windows.getAll();
      windowIds = windows.map(window => window.id);
    }
    if (!Array.isArray(windowIds)) {
      windowIds = [windowIds];
    }
    await Promise.all(windowIds.map(async (windowId) => {
      await WindowWrapper.setWindowPrefix(windowId, ' ');
      await WindowWrapper.setWindowPrefix(windowId, '');
    }));
  }

  static async setWindowPrefix(windowId, prefix) {
    return await browser.windows.update(windowId, { titlePreface: prefix });
  }
}



var getWindowFilter = () => {
  let ignorePrivate = settings.ignorePrivateWindows;
  return (wrapper) => {
    let window = wrapper.window;
    if (ignorePrivate && window.incognito) {
      return false;
    }
    return true;
  };
};

var windowWrapperCollection;
let startTabCounter = async () => {
  await settingsTracker.start;
  if (!windowWrapperCollection && settings.isEnabled) {
    windowWrapperCollection = new WindowWrapperCollection(
      settings.timeBetweenUpdatesInMilliseconds, 
      settings.windowPrefixFormat,
      getWindowFilter(),
    );
  }
};
let stopTabCounter = () => {
  if (windowWrapperCollection) {
    windowWrapperCollection.stop();
  }
  windowWrapperCollection = null;
};


var settingsTracker = new SettingsTracker(null, (changes, storageArea) => {

  if (changes.isEnabled) {
    if (changes.isEnabled.newValue) {
      startTabCounter();
    } else {
      stopTabCounter();
    }
  }

  if (!settings.isEnabled || !windowWrapperCollection) {
    return;
  }

  if (changes.windowPrefixFormat) {
    windowWrapperCollection.titleFormat = changes.windowPrefixFormat.newValue;
  }
  if (changes.timeBetweenUpdatesInMilliseconds) {
    windowWrapperCollection.blockTime = changes.timeBetweenUpdatesInMilliseconds.newValue;
  }
  if (changes.ignorePrivateWindows) {
    windowWrapperCollection.windowFilter = getWindowFilter();
  }
});
var settings = settingsTracker.settings;

let runtimeListeners = new DisposableCollection([

  new EventListener(browser.runtime.onMessage,
    async (
      message,      // object. The message itself. This is a JSON-ifiable object.
      sender,       // A runtime.MessageSender object representing the sender of the message.
    ) => {
      if (!message || !message.type || "string" !== typeof message.type) {
        return;
      }

      switch (message.type) {
        case "clearPrefix": {
          stopTabCounter();
          await WindowWrapper.clearWindowPrefixes();
        } break;
      }
    }),
  new EventListener(browser.runtime.onInstalled,
    ({
      id,               // string. The ID of the imported shared module extension that updated. This is present only if the reason value is shared_module_update
      previousVersion,  // string. The previous version of the extension just updated. This is only present if the reason value is update.
      reason,           // An runtime.OnInstalledReason value, stating the reason that this event is being dispatched. Values: "install", "update", "browser_update", "shared_module_update".
      temporary,        // boolean. True if the add-on was installed temporarily. For example, using the "about:debugging" page in Firefox or using web-ext run. False otherwise.
    }) => {

    }
  ),
]);


startTabCounter();
