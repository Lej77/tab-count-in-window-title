
const filterType = Object.freeze({
  tabCount: 'tab-count',
  title: 'title-prefix',
});


var onWindowDataUpdate = new EventManager();
var onPermissionsChange = new EventManager();

var tabOnCreated = EventManager.createPassthroughEventManager(browser.tabs.onCreated);
var tabOnRemoved = EventManager.createPassthroughEventManager(browser.tabs.onRemoved);


class WindowWrapperCollection {
  constructor(blockTime, titleFormat, windowFilter, newTabNoTitleFixOptions = {}, windowDataSettings = {}) {
    this.array = [];

    let onTabCountChange = new EventManager();
    this.onTabCountChange = onTabCountChange.subscriber;

    let onWindowDataChange = new EventManager();
    this.onWindowDataChange = onWindowDataChange.subscriber;


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
      return (collection, filterType) => {
        return true;
      };
    };
    let setWindowFilter = (value) => {
      if (windowFilter === value) {
        return;
      }
      windowFilter = value;

      this.updateWindowTitles();
    };
    defineProperty(this, 'windowFilter', getWindowFilter, setWindowFilter);

    // #endregion Window Filter


    // #region Title Format

    var cachedFormatInfo = null;
    var getFormatInfo = () => {
      if (!cachedFormatInfo) {
        cachedFormatInfo = FormatPlaceholder.createFormatInfo(titleFormat);
      }
      return cachedFormatInfo;
    };
    var clearFormatInfo = () => {
      let oldInfo = getFormatInfo();
      cachedFormatInfo = null;
      let newInfo = getFormatInfo();
      if (!deepCopyCompare(oldInfo, newInfo)) {
        clearGlobalFormatInfo();
      }
    };
    defineProperty(this, 'localFormatInfo', getFormatInfo);

    var cachedGlobalFormatInfo = null;
    var getGlobalFormatInfo = () => {
      if (!cachedGlobalFormatInfo) {
        let newFormatInfo = getFormatInfo();
        if (newFormatInfo.useWindowName) {
          let windowFormatInfo = this.array.map((wrapper) => {
            let formats = [];
            let overrideInfo = wrapper.overrideFormatInfo;
            if (overrideInfo.useOverride) {
              formats.push(overrideInfo);
              if (overrideInfo.useWindowName) {
                formats.push(wrapper.formatInfo);
              }
            } else if (newFormatInfo.useWindowName) {
              formats.push(wrapper.formatInfo);
            }
            return formats;
          });
          windowFormatInfo.push(newFormatInfo);
          newFormatInfo = FormatPlaceholder.combineFormatInfos(windowFormatInfo);
        }
        cachedGlobalFormatInfo = newFormatInfo;
      }
      return cachedGlobalFormatInfo;
    };
    var clearGlobalFormatInfo = () => {
      let oldInfo = getGlobalFormatInfo();
      cachedGlobalFormatInfo = null;
      let newInfo = getGlobalFormatInfo();
      if (isStarted && !deepCopyCompare(oldInfo, newInfo)) {
        startNeededListeners();
      }
    };
    defineProperty(this, 'formatInfo', getGlobalFormatInfo);

    var getTitleFormat = () => titleFormat;
    var setTitleFormat = (value) => {
      if (!value || typeof value !== 'string') {
        value = '';
      }
      if (value === titleFormat) {
        return;
      }

      titleFormat = value;
      clearFormatInfo();

      this.updateWindowTitles();
    };
    setTitleFormat(titleFormat);
    defineProperty(this, 'titleFormat', getTitleFormat, setTitleFormat);

    // #endregion Title Format


    // #region New Tab No Title Fix

    let getNewTabFix_Enabled = () => {
      return newTabNoTitleFixOptions.isEnabled;
    };
    let getNewTabFix_TrackHandledTabs = () => {
      return newTabNoTitleFixOptions.trackHandled;
    };
    let getNewTabFix_LoadWaitTime = () => {
      return newTabNoTitleFixOptions.loadWait;
    };
    let getNewTabFix_MinPrefixWait = () => {
      return newTabNoTitleFixOptions.minPrefixWait;
    };
    let getNewTabFix_ReloadWaitTime = () => {
      return newTabNoTitleFixOptions.reloadWait;
    };
    let getNewTabFixOptions = () => {
      return newTabNoTitleFixOptions;
    };
    let setNewTabFixOptions = (value) => {
      if (value === newTabNoTitleFixOptions) {
        return;
      }
      newTabNoTitleFixOptions = value;
      timeDisposables.dispose();
      timeDisposables = new DisposableCollection();
      startNeededListeners();
    };
    defineProperty(this, 'newTabNoTitleFixOptions', getNewTabFixOptions, setNewTabFixOptions);

    // #endregion New Tab No Title Fix


    // #region Window Data Settings

    var getWindowDataSettings = () => {
      return windowDataSettings;
    };
    var setWindowDataSettings = async (value) => {
      if (deepCopyCompare(value, windowDataSettings)) {
        windowDataSettings = value;
        return;
      }
      let oldValue = windowDataSettings;
      windowDataSettings = value;

      if (isStarted) {
        let wrappersBefore = this.array;
        startNeededListeners();


        if (Boolean(value.trackRestore) !== Boolean(oldValue.trackRestore)) {
          let wrappers;
          if (wrappersBefore.length > 0) {
            wrappers = wrappersBefore;
          } else {
            await this.start;
            wrappers = this.array;
          }
          if (wrappers.length > 0) {
            wrappers.forEach(wrapper => wrapper.trackSessionRestore = value.trackRestore);
          } else {
            let keyDataCombo = {};
            keyDataCombo[windowDataKeys.isRestored] = value.trackRestore ? true : undefined;
            await WindowWrapperCollection.setWindowData(keyDataCombo);
          }
        }
      }
    };
    defineProperty(this, 'windowDataSettings', getWindowDataSettings, setWindowDataSettings);

    // #endregion Window Data Settings


    // #region Listeners

    var startNeededListeners = () => {
      isStarted = true;
      let info = getGlobalFormatInfo();
      let windowInfo = getWindowDataSettings();

      let trackWindowFocus = windowInfo.inheritName || windowInfo.inheritSettings;
      let handleWindowData = (windowInfo.defaultName && windowInfo.defaultName !== '') || windowInfo.inheritName || windowInfo.inheritSettings;

      let trackTabs = info.useTabCount || info.useTotalTabCount;
      let trackNewTabs = getNewTabFix_Enabled();
      let trackWindows = info.hasText || handleWindowData || trackTabs || trackNewTabs;

      // console.log(`tracking:\nTabs: ${trackTabs}\nWindows: ${Boolean(trackWindows || trackTabs || trackNewTabs)}\nNewTabFix: ${trackNewTabs}`);

      if (trackNewTabs) {
        startNewTabNoTitleFixListeners();
      } else {
        if (newTabNoTitleFixListeners) {
          newTabNoTitleFixListeners.dispose();
        }
      }

      if (trackTabs) {
        startTabAddRemoveListeners();
      } else {
        if (tabAddRemoveListeners) {
          tabAddRemoveListeners.dispose();
        }
      }

      if (trackWindowFocus) {
        startWindowListeners();
        startWindowFocusedListeners();
      } else {
        if (windowFocusedListeners) {
          windowFocusedListeners.dispose();
        }
      }

      if (trackWindows) {
        startWindowListeners();
      } else {
        if (windowListeners) {
          this.array.forEach(wrapper => wrapper.clearPrefix());
          windowListeners.dispose();
        }
      }
    };

    var disposables = new DisposableCollection([
      new EventListener(onTabCountChange, (wrapper) => handleEvent(() => {
        let affectedWrappers = [];

        if (getGlobalFormatInfo().useOverride) {
          let checkFormat = (info, aWrapper) => {
            if (info.useWindowName) {
              info = FormatPlaceholder.combineFormatInfos([info, aWrapper.formatInfo]);
            }
            return info.useTotalTabCount || info.useCount || (aWrapper === wrapper && info.useTabCount);
          };
          affectedWrappers.push.apply(affectedWrappers, this.array.filter(aWrapper => {
            return checkFormat(aWrapper.overrideFormatInfo.useOverride ? aWrapper.overrideFormatInfo : getFormatInfo(), aWrapper);
          }));
        } else if (getFormatInfo().useTotalTabCount || getFormatInfo().useCount) {
          affectedWrappers.push.apply(affectedWrappers, this.array);
        } else if (getFormatInfo().useWindowName) {
          affectedWrappers.push.apply(affectedWrappers, this.array.filter(aWrapper => aWrapper.formatInfo.useTotalTabCount || aWrapper.formatInfo.useCount || (aWrapper === wrapper && (getFormatInfo().useTabCount || aWrapper.formatInfo.useTabCount))));
        } else if (getFormatInfo().useTabCount) {
          affectedWrappers.push(wrapper);
        }
        this.updateWindowTitles(affectedWrappers);
      })),
      new EventListener(onWindowDataChange, (wrapper, dataKey, newValue) => handleEvent(() => {
        let affectedWrappers = [wrapper];
        if (getGlobalFormatInfo().useOverride) {
          let checkFormat = (info, aWrapper) => {
            if (info.useWindowName) {
              info = FormatPlaceholder.combineFormatInfos([info, aWrapper.formatInfo]);
            }
            return info.useCount;
          };
          affectedWrappers.push.apply(affectedWrappers, this.array.filter(aWrapper => {
            return checkFormat(aWrapper.overrideFormatInfo.useOverride ? aWrapper.overrideFormatInfo : getFormatInfo(), aWrapper);
          }));
        } else if (getFormatInfo().useCount) {
          affectedWrappers.push.apply(affectedWrappers, this.array);
        } else if (getFormatInfo().useWindowName) {
          affectedWrappers.push.apply(affectedWrappers, this.array.filter(aWrapper => aWrapper.formatInfo.useCount));
        }
        this.updateWindowTitles(affectedWrappers);
      })),
    ]);
    var timeDisposables = new DisposableCollection();

    let safeWait = async (time, disposableCollection) => {
      try {
        if (time < 0) {
          return;
        }
        let trackedWithArg = false;
        let timeout;
        try {
          let promiseWrapper = new PromiseWrapper();

          timeout = new Timeout(() => promiseWrapper.resolve(), time);
          new EventListener(timeout.onStop, () => promiseWrapper.resolve());
          if (!timeout.isActive) {
            promiseWrapper.resolve();
          }
          timeDisposables.trackDisposables(timeout);

          if (disposableCollection && disposableCollection instanceof DisposableCollection) {
            trackedWithArg = true;
            disposableCollection.trackDisposables(timeout);
          }

          await promiseWrapper.getValue();
        } finally {
          if (timeout) {
            timeout.stop();
            timeDisposables.untrackDisposables(timeout);
            if (trackedWithArg) {
              disposableCollection.untrackDisposables(timeout);
            }
          }
        }
      } catch (error) { }
    };
    let getWrapperAndDo = (windowId, callback) => {
      let wrapper = this.getWindowWrappersById(windowId);
      if (wrapper) {
        return callback(wrapper);
      }
    };



    var newTabNoTitleFixListeners = null;
    let newTabNoTitleFix_SetTrackHandled = null;
    var startNewTabNoTitleFixListeners = () => {
      if (newTabNoTitleFixListeners && !newTabNoTitleFixListeners.isDisposed) {
        let callback = newTabNoTitleFix_SetTrackHandled;
        if (callback && typeof callback === 'function') {
          let shouldTrackHandledTabs = getNewTabFix_TrackHandledTabs();
          callback(shouldTrackHandledTabs);
        }
        return;
      }


      let onTabStateChange = new EventManager();
      let waitForLoadState = async (tabId, timeoutTime, onlyCompletedLoading = false, useSafeWait = true) => {
        if (timeoutTime <= 0) {
          return;
        }
        let collection = new DisposableCollection();
        let loadStatePromiseWrapper = new PromiseWrapper();
        try {
          let maxTime;
          if (useSafeWait) {
            maxTime = safeWait(timeoutTime, collection);
          } else {
            maxTime = new Promise((resolve, reject) => {
              try {
                let timeout = new Timeout(resolve, timeoutTime);
                timeout.onStop.addListener(() => resolve());
                collection.trackDisposables(timeout);
              } catch (error) {
                reject(error);
              }
            });
          }
          let loadStateListener = new EventListener(onTabStateChange, (tabId2, loadState) => {
            if (tabId2 === tabId) {
              if (onlyCompletedLoading && loadState === 'loading') {
                return;
              }
              loadStatePromiseWrapper.resolve(loadState);
            }
          });
          collection.trackDisposables(loadStateListener);
          return await Promise.race([maxTime, loadStatePromiseWrapper.getValue()]);
        } finally {
          collection.dispose();
          loadStatePromiseWrapper.resolve();
        }
      };

      let isTrackingHandled = false;
      let handleTabIds = [];
      let newTabURLs = [
        'about:newtab',
        'about:home',
      ];
      let handleNewPage = async (tab, justCreated = false) => {
        // Some new tab pages has a title and some don't:
        // # New tab pages opened in private windows always have titles and they are always shown.
        // # New tab pages opened in new tabs needs to be reloaded to have a title and then the window title needs to be updated for it to be shown. The tab doesn't need to be reloaded if the tab was opened in a new window.
        // # New tab pages navigated to have a title but the window title needs to be updated before it is shown.

        // Window title is only updated at certain times:
        // # When title preface is set.
        // # When the window's active tab is changed.
        // # When the tab's page is changed. 
        //      This is normally done after the tab has loaded but if the title preface is set when the tab is loading then the tab's title at this moment will be used. 
        //      This means that if the tab has no title at that moment then the window preface won't be shown.
        //      The tab title can be set a bit after the tab.status is set to 'complete', even if it is usually set by then. So to ensure that the tab title is set its best to wait a bit extra.

        try {
          if (!getNewTabFix_Enabled() || tab.discarded || !tab.url || tab.incognito) {
            return;
          }

          let createTime = Date.now();


          // #region Wait for URL:

          let waitAttempt = 0;
          while (tab.url === 'about:blank') {
            waitAttempt++;
            if (waitAttempt > 4) {
              return;
            }
            if (waitAttempt + 1 > 4) {
              await safeWait(getNewTabFix_LoadWaitTime() - (Date.now() - createTime));
            } else {
              await delay(50);
            }
            try {
              tab = await browser.tabs.get(tab.id);
            } catch (error) { return; }
            if (!tab) {
              return;
            }
          }

          // #endregion Wait for URL


          // Check if url is a new tab url:
          if (!newTabURLs.includes(tab.url)) {
            return;
          }


          // #region Skip Fixed Tabs

          if (isTrackingHandled) {
            if (handleTabIds.includes(tab.id)) {
              // New tab page's title already fixed.
              return true;
            }
            handleTabIds.push(tab.id);
          }

          // #endregion Skip Fixed Tabs


          // #region Reload Tab

          let reloadRequired = justCreated && tab.url === 'about:newtab';
          if (reloadRequired) {
            // Min time before reloading tab:
            await safeWait(getNewTabFix_LoadWaitTime() - (Date.now() - createTime));

            // Reload tab:
            await browser.tabs.reload(tab.id);
          }

          // #endregion Reload Tab


          if (tab.active) {
            let reloadTime = Date.now();
            let newStatus = tab.status;


            // #region Ensure the tab is loaded

            if (reloadRequired || tab.status !== 'complete') {
              // Max wait before setting title prefix (continues on tab completing loading): 
              newStatus = await waitForLoadState(tab.id, getNewTabFix_ReloadWaitTime(), true);
            }

            // #endregion Ensure the tab is loaded


            // #region Ensure tab wasn't reloaded

            let getMinWaitTime = () => getNewTabFix_MinPrefixWait() - (Date.now() - reloadTime);
            if (!newStatus) {
              await safeWait(getMinWaitTime());
            }
            let minWaitForReloadTime = 50;
            while (newStatus) {
              // Wait to see if tab starts to load again:
              let waitForReloadTime = getMinWaitTime();
              if (waitForReloadTime < minWaitForReloadTime) {
                waitForReloadTime = minWaitForReloadTime;
              }
              newStatus = await waitForLoadState(tab.id, waitForReloadTime, true, waitForReloadTime > 250);
              while (newStatus && newStatus !== 'complete') {
                // Tab was reloaded => Wait for load completion:
                newStatus = await waitForLoadState(tab.id, getNewTabFix_ReloadWaitTime(), true);
              }
            }

            // #endregion Ensure tab wasn't reloaded


            // #region Recheck if tab is active

            try {
              tab = await browser.tabs.get(tab.id);
            } catch (error) { return true; }

            if (!tab.active) {
              return true;
            }

            // #endregion Recheck if tab is active


            // #region Set Window Preface

            let wrapper = this.getWindowWrappersById(tab.windowId);
            if (wrapper) {
              wrapper.forceSetTitlePrefix();
            } else {
              await WindowWrapper.clearWindowPrefixes([tab.windowId]);
              wrapper = this.getWindowWrappersById(tab.windowId);
              if (wrapper) {
                wrapper.forceSetTitlePrefix();
              }
            }

            // #endregion Set Window Preface
          }
          return true;
        } catch (error) { }
      };
      let removeHandledTabId = (tabId) => {
        while (true) {
          let index = handleTabIds.indexOf(tabId);
          if (index < 0) {
            break;
          }
          handleTabIds.splice(index, 1);
        }
      };
      let handleURLChange = async (tab) => {
        let affected = await handleNewPage(tab);
        if (!affected && isTrackingHandled) {
          removeHandledTabId(tab.id);
        }
      };

      let listeners = new DisposableCollection([
        new EventListener(browser.tabs.onUpdated, (tabId, changeInfo, tab) => {
          if (changeInfo.status || changeInfo.discarded) {
            let loadState = changeInfo.discarded ? 'discarded' : changeInfo.status;
            onTabStateChange.fire(tabId, loadState);
          }
          if (changeInfo.url) {
            if (changeInfo.status) {
              tab.status = changeInfo.status;
            }
            handleURLChange(tab);
          }
        }),
        new EventListener(tabOnCreated, (tab) => {
          handleNewPage(tab, true);
        }),
      ]);
      disposables.trackDisposables(listeners);

      let trackingListeners = null;
      let trackCallback = (value) => {
        if (value === isTrackingHandled) {
          return;
        }

        isTrackingHandled = value;
        handleTabIds = [];

        if (trackingListeners) {
          trackingListeners.dispose();
          listeners.untrackDisposables(trackingListeners);
          trackingListeners = null;
        }

        trackingListeners = new DisposableCollection([
          new EventListener(tabOnRemoved, (tabId, { windowId, isWindowClosing }) => {
            removeHandledTabId(tabId);
          }),
        ]);
        listeners.trackDisposables(trackingListeners);
      };

      listeners._onDisposed.addListener(() => {
        if (listeners === newTabNoTitleFixListeners) {
          newTabNoTitleFixListeners = null;
        }
        if (newTabNoTitleFix_SetTrackHandled === trackCallback) {
          newTabNoTitleFix_SetTrackHandled = null;
        }
        disposables.untrackDisposables(listeners);
      });
      newTabNoTitleFix_SetTrackHandled = trackCallback;
      newTabNoTitleFixListeners = listeners;

      trackCallback(getNewTabFix_TrackHandledTabs());
    };


    var tabAddRemoveListeners = null;
    var startTabAddRemoveListeners = () => {
      if (tabAddRemoveListeners) {
        return;
      }

      let listeners = new DisposableCollection([
        new EventListener(tabOnCreated, (tab) => handleEvent(async () => {
          getWrapperAndDo(tab.windowId, (wrapper) => {
            wrapper.tabAdded(tab.id);
          });
        })),
        new EventListener(tabOnRemoved, (tabId, { windowId, isWindowClosing }) => handleEvent(() => {
          getWrapperAndDo(windowId, (wrapper) => wrapper.tabRemoved(tabId));
        })),

        new EventListener(browser.tabs.onAttached, (tabId, { newWindowId, newPosition }) => handleEvent(() => {
          getWrapperAndDo(newWindowId, (wrapper) => wrapper.tabAdded(tabId));
        })),
        new EventListener(browser.tabs.onDetached, (tabId, { oldWindowId, oldPosition }) => handleEvent(() => {
          getWrapperAndDo(oldWindowId, (wrapper) => wrapper.tabRemoved(tabId));
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
          let initialWindowData = {};

          let winDataSettings = getWindowDataSettings();
          initialWindowData[windowDataKeys.name] = winDataSettings.defaultName;
          let lastWrapper;
          if (winDataSettings.inheritName || winDataSettings.inheritSettings) {
            lastWrapper = this.getWindowWrappersById(getLastFocusedWindow(window.id));
          }

          if (lastWrapper) {
            if (winDataSettings.inheritName) {
              initialWindowData[windowDataKeys.name] = lastWrapper.windowName;
            }
            if (winDataSettings.inheritSettings) {
              initialWindowData[windowDataKeys.settings] = lastWrapper.windowSettings;
            }
          }
          this.addWindowWrappers(new WindowWrapper(window, getBlockTime, winDataSettings.trackRestore, initialWindowData));
        })),
        new EventListener(browser.windows.onRemoved, (windowId) => handleEvent(() => {
          this.removeWindowWrappers(this.getWindowWrappersById(windowId));
        })),

        new EventListener(onWindowDataUpdate, (windowId, windowDataKey, newValue) => handleEvent(() => {
          getWrapperAndDo(windowId, (wrapper) => {
            wrapper.dataUpdate(windowDataKey, newValue);
          });
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
        if (newTabNoTitleFixListeners) {
          newTabNoTitleFixListeners.dispose();
        }
      });
      windowListeners = listeners;

      this.start = _start();
    };
    defineProperty(this, 'isTrackingWindows', () => Boolean(windowListeners));


    var windowFocusedListeners = null;
    var lastFocused = [];
    var focusCacheLength = 5;
    var focusedIndex = 0;
    var getLastFocusedWindow = (ignoredWindowIds = []) => {
      if (!Array.isArray(ignoredWindowIds)) {
        ignoredWindowIds = [ignoredWindowIds];
      }
      let index = focusedIndex;
      while (true) {
        if (index < 0) {
          index = lastFocused.length - 1;
          if (index === focusedIndex) {
            return null;
          }
        }
        if (index >= lastFocused.length) {
          return null;
        }
        let windowId = lastFocused[index];
        if (!ignoredWindowIds.includes(windowId)) {
          return windowId;
        }
        index--;
        if (index === lastFocused) {
          return null;
        }
      }
    };
    var startWindowFocusedListeners = async () => {
      if (windowFocusedListeners) {
        return;
      }

      let lastFocusedWindow = await browser.windows.getLastFocused();
      lastFocused = [lastFocusedWindow.id];
      let listeners = new DisposableCollection([
        new EventListener(browser.windows.onFocusChanged, (windowId) => {
          focusedIndex++;
          if (focusedIndex >= focusCacheLength) {
            focusedIndex = 0;
          }
          lastFocused.splice(focusedIndex, 1, windowId);
        }),
      ]);
      disposables.trackDisposables(listeners);

      new EventListener(listeners.onDisposed, () => {
        if (listeners === windowFocusedListeners) {
          windowFocusedListeners = null;
          lastFocused = [];
          focusedIndex = 0;
        }
        disposables.untrackDisposables(listeners);
      });

      windowFocusedListeners = listeners;
    };

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
        this.array.sort((a, b) => a.window.id - b.window.id);
        ids.push(wrapper.window.id);

        // Wrapper event listeners:
        let wrapperListeners = new DisposableCollection([
          new EventListener(wrapper.onTabCountChange, () => onTabCountChange.fire(wrapper)),
          new EventListener(wrapper.onDataChange, (wrapper, dataKey, newValue) => onWindowDataChange.fire(wrapper, dataKey, newValue)),
          new EventListener(wrapper.onFormatInfoChange, () => {
            clearGlobalFormatInfo();
            if (isStarted) {
              startNeededListeners();
            }
          }),
        ]);
        new EventListener(wrapper.onDisposed, () => {
          wrapperListeners.dispose();
        });

        onTabCountChange.fire(wrapper);
        clearGlobalFormatInfo();
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
          clearGlobalFormatInfo();
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
    };
    var _start = async () => {
      if (isDisposed) {
        return;
      }

      isStarted = false;
      let windows = await browser.windows.getAll({ populate: true });

      let winDataSettings = getWindowDataSettings();
      this.addWindowWrappers(windows.map(window => new WindowWrapper(window, getBlockTime, winDataSettings.trackRestore)));

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
    if (windowWrappers.length === 0) {
      return;
    }

    let cachedFormat = this.titleFormat;
    let cachedTotalTabCount = '';
    if (this.formatInfo.useTotalTabCount) {
      cachedTotalTabCount = WindowWrapperCollection.calculateTotalTabCount(this.windowFilter(this, filterType.tabCount));
    }

    let allowed = this.windowFilter(this, filterType.title);
    let updated = [];
    let usedPrefixes = allowed
      .filter((wrapper) => !windowWrappers.includes(wrapper))       // Only include wrappers that are not going to be updated.
      .map(wrapper => wrapper.cachedUsedPrefixForCountPlaceholder || ''); // Get the last prefix format used for the %Count% placeholder.

    for (let wrapper of this.array) {
      if (!windowWrappers.includes(wrapper)) {
        continue;
      }

      updated.push(wrapper);

      if (!allowed.includes(wrapper)) {
        wrapper.clearPrefix();
        continue;
      }

      let overrides = wrapper.overrideFormatInfo.useOverride ? wrapper.windowSettings : null;

      let prefix = cachedFormat;
      let useIfWindowName = this.formatInfo.useIfWindowName;
      if (overrides && overrides.windowPrefixFormat.override) {
        useIfWindowName = wrapper.overrideFormatInfo.useIfWindowName;
        prefix = overrides.windowPrefixFormat.value;
      }

      if (useIfWindowName) {
        prefix = formatPlaceholders.ifWindowName.apply(prefix, (arg1, arg2) => wrapper.windowName ? arg1 : arg2);
      }

      prefix = prefix.replace(formatPlaceholders.windowName.regExp, wrapper.windowName);

      // Ensure unique prefix:
      if (formatPlaceholders.count.test(prefix)) {
        let initialPrefix = prefix;
        let count = 1;
        do {
          prefix = initialPrefix.replace(formatPlaceholders.count.regExp, count++);
        } while (usedPrefixes.some(usedPrefix => usedPrefix === prefix));
      }
      wrapper.cachedUsedPrefixForCountPlaceholder = prefix;
      usedPrefixes.push(prefix);

      prefix = (prefix
        .replace(formatPlaceholders.tabCount.regExp, wrapper.tabCount)
        .replace(formatPlaceholders.totalTabCount.regExp, cachedTotalTabCount)


        .replace(formatPlaceholders.firefoxVersion.regExp, browserInfo.version)
        .replace(formatPlaceholders.firefoxBuildId.regExp, browserInfo.buildID)

        .replace(formatPlaceholders.platformOS.regExp, platformInfo.os)
        .replace(formatPlaceholders.platformArchitecture.regExp, platformInfo.arch)
      );

      wrapper.setTitlePrefix(prefix);
    }
  }

  static calculateTotalTabCount(windowWrappers) {
    let tabCount = 0;
    for (let windowWrapper of windowWrappers) {
      tabCount += windowWrapper.tabCount;
    }
    return tabCount;
  }

  static async setWindowData(dataKeyValueCombos) {
    if (!dataKeyValueCombos) {
      return;
    }
    let dataKeys = Object.keys(dataKeyValueCombos);
    if (dataKeys.length === 0) {
      return;
    }
    let windows = await browser.windows.getAll();
    let removeData = async (windowId, dataKey) => {
      await browser.sessions.removeWindowValue(windowId, dataKey);
      onWindowDataUpdate.fire(windowId, dataKey, undefined);
    };
    let setData = async (windowId, dataKey, value) => {
      await browser.sessions.setWindowValue(windowId, dataKey, value);
      onWindowDataUpdate.fire(windowId, dataKey, value);
    };
    let promises = [];
    for (let window of windows) {
      for (let key of dataKeys) {
        let value = dataKeyValueCombos[key];
        promises.push(value === undefined ? removeData(window.id, key) : setData(window.id, key, value));
      }
    }
    await Promise.all(promises);
  }
}



class WindowWrapper {
  constructor(window, blockTime, trackSessionRestore, initialWindowData = {}) {
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


    // #region Window Data

    let handleRestoreData = async (tracking) => {
      let isTracked = false;
      try {
        if (tracking) {
          isTracked = await browser.sessions.getWindowValue(window.id, windowDataKeys.isRestored);
          return isTracked;
        } else {
          return false;
        }
      } finally {
        if (tracking) {
          if (!isTracked) {
            browser.sessions.setWindowValue(window.id, windowDataKeys.isRestored, true);
          }
        } else {
          browser.sessions.removeWindowValue(window.id, windowDataKeys.isRestored);
        }
      }
    };
    let isRestoredWindow = handleRestoreData(trackSessionRestore);
    this.isRestoredWindow = isRestoredWindow;

    defineProperty(this, 'trackSessionRestore', () => trackSessionRestore, (value) => {
      value = Boolean(value);
      if (Boolean(trackSessionRestore) === value) {
        return;
      }
      trackSessionRestore = value;
      isRestoredWindow = Promise.resolve(isRestoredWindow).finally(() => handleRestoreData(trackSessionRestore));
    });

    let onWindowDataChange = new EventManager();
    this.onDataChange = onWindowDataChange.subscriber;

    let cachedFormatInfo = null;
    let getFormatInfo = () => {
      if (!cachedFormatInfo) {
        cachedFormatInfo = FormatPlaceholder.createFormatInfo(this.windowName);
        cachedFormatInfo.useIfWindowName = false;
      }
      return cachedFormatInfo;
    };
    let clearFormatInfo = () => {
      let oldInfo = getFormatInfo();
      cachedFormatInfo = null;
      let newInfo = getFormatInfo();
      if (!deepCopyCompare(oldInfo, newInfo)) {
        onFormatInfoChange.fire();
      }
    };
    defineProperty(this, 'formatInfo', getFormatInfo);

    let cachedOverrideFormatInfo = null;
    let getOverrideFormatInfo = () => {
      if (!cachedOverrideFormatInfo) {
        let overrideSettings = this.windowSettings;
        cachedOverrideFormatInfo = FormatPlaceholder.createFormatInfo(overrideSettings.windowPrefixFormat.override ? overrideSettings.windowPrefixFormat.value : '');
        if (overrideSettings.windowPrefixFormat.override) {
          cachedOverrideFormatInfo.useOverride = true;
        }
      }
      return cachedOverrideFormatInfo;
    };
    let clearOverrideFormatInfo = () => {
      let oldInfo = getOverrideFormatInfo();
      cachedOverrideFormatInfo = null;
      let newInfo = getOverrideFormatInfo();
      if (!deepCopyCompare(oldInfo, newInfo)) {
        onFormatInfoChange.fire();
      }
    };
    defineProperty(this, 'overrideFormatInfo', getOverrideFormatInfo);

    var onFormatInfoChange = new EventManager();
    this.onFormatInfoChange = onFormatInfoChange.subscriber;

    onWindowDataChange.addListener((wrapper, dataKey, value) => {
      if (dataKey === windowDataKeys.name) {
        clearFormatInfo();
      }
      if (dataKey === windowDataKeys.settings) {
        clearOverrideFormatInfo();
      }
    });

    let onDataUpdate = new EventManager();
    this.dataUpdate = (key, newValue) => {
      onDataUpdate.fire(key, newValue);
    };

    let wrapper = this;
    var createDataMonitor = (valueTest, dataKey, propertyName, initialValue) => {
      initialValue = (async () => deepCopy(await initialValue))();
      let defaultData = valueTest();
      let data = defaultData;
      let dataChanged = false;
      browser.sessions.getWindowValue(window.id, dataKey).then(async (value) => {
        if (dataChanged) {
          return;
        }
        if (value === undefined) {
          initialValue = await initialValue;
          if (dataChanged || initialValue === undefined || (await isRestoredWindow)) {
            return;
          }
          updateData(initialValue);
        } else {
          setData(value);
        }
      });
      var getData = () => {
        return deepCopy(data);
      };
      var setData = (value) => {
        value = deepCopy(value);
        dataChanged = true;
        value = valueTest(value);
        if (deepCopyCompare(value, data)) {
          data = value;
          return;
        }
        data = value;

        onWindowDataChange.fire(wrapper, dataKey, value);
      };
      var updateData = async (value) => {
        value = valueTest(value);
        if (deepCopyCompare(value, defaultData)) {
          await browser.sessions.removeWindowValue(window.id, dataKey);
        } else {
          await browser.sessions.setWindowValue(window.id, dataKey, value);
        }
        setData(value);
      };
      new EventListener(onDataUpdate, (key, newValue) => {
        if (key === dataKey) {
          setData(newValue);
        }
      });
      defineProperty(this, propertyName, getData, setData);
    };

    if (!initialWindowData) {
      initialWindowData = {};
    }
    createDataMonitor((value) => {
      if (!value) {
        return '';
      }
      return value;
    }, windowDataKeys.name, 'windowName', initialWindowData[windowDataKeys.name]);
    createDataMonitor((value) => {
      if (!value || typeof value !== 'object') {
        value = {};
      }
      let defaultValues = {
        windowPrefixFormat: '',
      };
      for (let key of Object.keys(defaultValues)) {
        if (!value[key]) {
          value[key] = {};
        }
        let overrideSetting = value[key];
        if (!overrideSetting.value) {
          overrideSetting.value = defaultValues[key];
        }
        if (defaultValues[key] === Boolean(defaultValues[key])) {
          overrideSetting.value = Boolean(overrideSetting.value);
        }
        overrideSetting.override = Boolean(overrideSetting.override);
      }
      return value;
    }, windowDataKeys.settings, 'windowSettings', initialWindowData[windowDataKeys.settings]);

    // #endregion Window Data


    // #region Dispose

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

    // #endregion Dispose


    // #region Title

    let forceTitleUpdate = false;
    let titleUpdateManager = new RequestManager(
      async (value, forceUpdate) => {
        if (lastTitlePrefix === value && !forceTitleUpdate && !forceUpdate) {
          return;
        }
        forceTitleUpdate = false;
        if (!value || value === '') {
          await clearPrefix();
        } else {
          await WindowWrapper.setWindowPrefix(window.id, value);
          lastTitlePrefix = value;
        }
      },
      blockTime,
      true
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
    let forceSetPrefix = (forceUpdateNow = true) => {
      let latestValue = titleUpdateManager.lastArgs;
      if (latestValue.length > 0) {
        latestValue = latestValue[0];
      } else {
        latestValue = lastTitlePrefix;
      }
      if (forceUpdateNow) {
        titleUpdateManager.forceUpdate(latestValue, true);
      } else {
        forceTitleUpdate = true;
        titleUpdateManager.invalidate(latestValue);
      }
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
      forceSetTitlePrefix: forceSetPrefix,

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



var browserInfo = browser.runtime.getBrowserInfo();
var platformInfo = browser.runtime.getPlatformInfo();

var settingsTracker = new SettingsTracker();
var settings = settingsTracker.settings;

var waitForLoad = async () => {
  browserInfo = await browserInfo;
  platformInfo = await platformInfo;
  await settingsTracker.start;
};


var createWindowFilter = () => {
  let ignorePrivate_Tabs = settings.ignorePrivateWindows;
  let ignorePrivate_Titles = settings.dontSetPrivateWindowTitles;

  return (collection, filter) => {
    let ignorePrivate = (filter === filterType.tabCount) ? ignorePrivate_Tabs : ignorePrivate_Titles;
    return collection.array.filter(wrapper => {
      let window = wrapper.window;
      if (ignorePrivate && window.incognito) {
        return false;
      }
      return true;
    });
  };
};
var createNewTabFixOptions = () => {
  return {
    isEnabled: settings.newTabNoTitleWorkaround_Enabled,
    trackHandled: settings.newTabNoTitleWorkaround_TrackHandledTabs,

    loadWait: settings.newTabNoTitleWorkaround_LoadWaitInMilliseconds,
    minPrefixWait: settings.newTabNoTitleWorkaround_MinPrefixWaitInMilliseconds,
    reloadWait: settings.newTabNoTitleWorkaround_ReloadWaitInMilliseconds,
  };
};
let createWindowDataSettings = () => {
  return {
    defaultName: settings.windowDefaultName,
    inheritName: settings.windowInheritName,
    inheritSettings: settings.windowInheritSettings,

    trackRestore: settings.windowTrackSessionRestore,
  };
};

var windowWrapperCollection;
let startTabCounter = async () => {
  await waitForLoad();
  if (!windowWrapperCollection && settings.isEnabled) {
    windowWrapperCollection = new WindowWrapperCollection(
      settings.timeBetweenUpdatesInMilliseconds,
      settings.windowPrefixFormat,
      createWindowFilter(),
      createNewTabFixOptions(),
      createWindowDataSettings(),
    );
  }
};
let stopTabCounter = () => {
  if (windowWrapperCollection) {
    windowWrapperCollection.stop();
  }
  windowWrapperCollection = null;
};

new EventListener(settingsTracker.onChange, (changes, storageArea) => {

  if (changes.isEnabled) {
    if (changes.isEnabled.newValue) {
      startTabCounter();
      return;
    } else {
      stopTabCounter();
    }
  }


  if (!settings.isEnabled || !windowWrapperCollection) {
    if (changes.windowTrackSessionRestore) {
      let keyDataCombo = {};
      keyDataCombo[windowDataKeys.isRestored] = settings.windowTrackSessionRestore ? true : undefined;
      WindowWrapperCollection.setWindowData(keyDataCombo);
    }
    return;
  }

  if (changes.windowPrefixFormat) {
    windowWrapperCollection.titleFormat = changes.windowPrefixFormat.newValue;
  }
  if (changes.timeBetweenUpdatesInMilliseconds) {
    windowWrapperCollection.blockTime = changes.timeBetweenUpdatesInMilliseconds.newValue;
  }
  if (
    changes.ignorePrivateWindows ||
    changes.dontSetPrivateWindowTitles
  ) {
    windowWrapperCollection.windowFilter = createWindowFilter();
  }

  if (
    changes.newTabNoTitleWorkaround_Enabled ||
    changes.newTabNoTitleWorkaround_TrackHandledTabs ||
    changes.newTabNoTitleWorkaround_LoadWaitInMilliseconds ||
    changes.newTabNoTitleWorkaround_ReloadWaitInMilliseconds ||
    changes.newTabNoTitleWorkaround_MinPrefixWaitInMilliseconds
  ) {
    windowWrapperCollection.newTabNoTitleFixOptions = createNewTabFixOptions();
  }

  if (
    changes.windowDefaultName ||
    changes.windowInheritName ||
    changes.windowInheritSettings ||
    changes.windowTrackSessionRestore
  ) {
    windowWrapperCollection.windowDataSettings = createWindowDataSettings();
  }
});

startTabCounter();



var portManager = new PortManager();
onPermissionsChange.addListener(function () {
  portManager.fireEvent('permissionChanged', Array.from(arguments));
});


let runtimeListeners = new DisposableCollection([
  new EventListener(portManager.onMessage, async (
    message,      // object. The message itself. This is a JSON-ifiable object.
    sender,       // A runtime.MessageSender object representing the sender of the message.
    disposables,  // Collection that will be disposed if the operation is canceled.
  ) => {
    if (!message || !message.type || "string" !== typeof message.type) {
      return;
    }
    switch (message.type) {
      case messageTypes.clearPrefix: {
        stopTabCounter();
        await WindowWrapper.clearWindowPrefixes();
      } break;
      case messageTypes.updatePrefix: {
        let forceUpdateAllTitles = () => Promise.all(windowWrapperCollection.array.map(wrapper => wrapper.forceSetTitlePrefix()));
        if (windowWrapperCollection) {
          forceUpdateAllTitles();
        } else {
          await WindowWrapper.clearWindowPrefixes();
          if (windowWrapperCollection) {
            forceUpdateAllTitles();
          }
        }
      } break;
      case messageTypes.windowDataChange: {
        onWindowDataUpdate.fire(message.windowId, message.key, message.newValue);
      } break;
      case messageTypes.permissionsChanged: {
        onPermissionsChange.fire(message.permission, message.value);
      } break;
      case messageTypes.requestPermission: {
        let requester = new ToolbarPermissionRequest(message.permission);
        if (disposables && disposables instanceof DisposableCollection) {
          disposables.trackDisposables(requester);
        }
        let result = await requester.result;
        if (result) {
          onPermissionsChange.fire(message.permission, await browser.permissions.contains(message.permission));
        }
        return result;
      } break;
      case messageTypes.clearWindowData: {
        let dataKeyValueCombos = {};
        for (let key of Object.keys(windowDataKeys)) {
          let dataKey = windowDataKeys[key];
          if (!message.clearInternalData && dataKey === windowDataKeys.isRestored) {
            continue;
          }
          dataKeyValueCombos[dataKey] = undefined;
        }
        await WindowWrapperCollection.setWindowData(dataKeyValueCombos);
      } break;
      case messageTypes.applyWindowName: {
        let dataKeyValueCombos = {};
        dataKeyValueCombos[windowDataKeys.name] = message.name && message.name !== '' ? message.name : undefined;
        await WindowWrapperCollection.setWindowData(dataKeyValueCombos);
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