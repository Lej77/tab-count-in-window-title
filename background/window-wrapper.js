'use strict';

import {
    formatPlaceholders,
    FormatPlaceholder,
    windowDataKeys,
} from '../common/common.js';

import {
    EventManager,
    EventListener,
    PassthroughEventManager,
} from '../common/events.js';

import {
    defineProperty,
    deepCopy,
    deepCopyCompare,
} from '../common/utilities.js';

import {
    DisposableCollection,
} from '../common/disposables.js';

import {
    delay,
    Timeout,
    PromiseWrapper,
    RequestManager,
} from '../common/delays.js';

import {
    onWindowDataUpdate,
    browserInfo,
    platformInfo,
} from '../background/background.js';


/**
 * @typedef {import('../common/disposables.js').IDisposable} IDisposable
 */

/**
 * @typedef {import('../common/utilities.js').BrowserTab} BrowserTab
 */

/**
 * @typedef {import('../common/utilities.js').BrowserWindow} BrowserWindow
 */


// Allow sharing extension API event listeners to hopefully decrease overhead:
const tabOnCreated = new PassthroughEventManager(browser.tabs.onCreated);
const tabOnRemoved = new PassthroughEventManager(browser.tabs.onRemoved);

export const filterType = Object.freeze({
    tabCount: 'tab-count',
    title: 'title-prefix',
});


export class WindowWrapperCollection {
    constructor(blockTime, titleFormat, windowFilter, newTabNoTitleFixOptions = {}, windowDataSettings = {}) {
        /** @type {WindowWrapper[]} */
        this.array = [];

        const onTabCountChange = new EventManager();
        this.onTabCountChange = onTabCountChange.subscriber;

        const onActiveTabChange = new EventManager();
        this.onActiveTabChange = onActiveTabChange.subscriber;

        const onWindowDataChange = new EventManager();
        this.onWindowDataChange = onWindowDataChange.subscriber;


        // #region Max Tabs to allow "tabs query" for updating tab count

        let recountTabsWhenEqualOrLessThan = -1;
        const getRecountTabsWhenEqualOrLessThan = () => recountTabsWhenEqualOrLessThan;
        const setRecountTabsWhenEqualOrLessThan = (value) => {
            if (value === recountTabsWhenEqualOrLessThan) {
                return;
            }
            recountTabsWhenEqualOrLessThan = value;

            // Ensure that new recount value is used:
            for (const wrapper of this.array) {
                wrapper.recountTabsWhenEqualOrLessThan = value;
            }
        };
        defineProperty(this, 'recountTabsWhenEqualOrLessThan', getRecountTabsWhenEqualOrLessThan, setRecountTabsWhenEqualOrLessThan);

        // #endregion Max Tabs to allow "tabs query" for updating tab count


        // #region Block Time in milliseconds

        const getBlockTime = () => blockTime;
        const setBlockTime = (value) => {
            if (value === blockTime) {
                return;
            }
            blockTime = value;

            // Ensure that new block time is used:
            for (const wrapper of this.array) {
                wrapper.unblockTabUpdate();
                wrapper.unblockTitleUpdate();
            }
        };
        defineProperty(this, 'blockTime', getBlockTime, setBlockTime);

        // #endregion Block Time in milliseconds


        // #region Window Filter

        const getWindowFilter = () => {
            if (windowFilter && typeof windowFilter === 'function') {
                return windowFilter;
            }
            return (collection, filterType) => {
                return true;
            };
        };
        const setWindowFilter = (value) => {
            if (windowFilter === value) {
                return;
            }
            windowFilter = value;

            this.updateWindowTitles();
        };
        defineProperty(this, 'windowFilter', getWindowFilter, setWindowFilter);

        // #endregion Window Filter


        // #region Title Format

        let cachedFormatInfo = null;
        const getFormatInfo = () => {
            if (!cachedFormatInfo) {
                cachedFormatInfo = FormatPlaceholder.createFormatInfo(titleFormat);
            }
            return cachedFormatInfo;
        };
        const clearFormatInfo = () => {
            let oldInfo = getFormatInfo();
            cachedFormatInfo = null;
            let newInfo = getFormatInfo();
            if (!deepCopyCompare(oldInfo, newInfo)) {
                clearGlobalFormatInfo();
            }
        };
        defineProperty(this, 'localFormatInfo', getFormatInfo);

        let cachedGlobalFormatInfo = null;
        const getGlobalFormatInfo = () => {
            if (!cachedGlobalFormatInfo) {
                let newFormatInfo = getFormatInfo();
                if (newFormatInfo.useWindowName) {
                    const windowFormatInfo = this.array.map((wrapper) => {
                        const formats = [];
                        const overrideInfo = wrapper.overrideFormatInfo;
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
        const clearGlobalFormatInfo = () => {
            const oldInfo = getGlobalFormatInfo();
            cachedGlobalFormatInfo = null;
            const newInfo = getGlobalFormatInfo();
            if (isStarted && !deepCopyCompare(oldInfo, newInfo)) {
                startNeededListeners();
            }
        };
        defineProperty(this, 'formatInfo', getGlobalFormatInfo);

        const getTitleFormat = () => titleFormat;
        const setTitleFormat = (value) => {
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

        const getNewTabFix_Enabled = () => {
            return newTabNoTitleFixOptions.isEnabled;
        };
        const getNewTabFix_TrackHandledTabs = () => {
            return newTabNoTitleFixOptions.trackHandled;
        };
        const getNewTabFix_LoadWaitTime = () => {
            return newTabNoTitleFixOptions.loadWait;
        };
        const getNewTabFix_MinPrefixWait = () => {
            return newTabNoTitleFixOptions.minPrefixWait;
        };
        const getNewTabFix_ReloadWaitTime = () => {
            return newTabNoTitleFixOptions.reloadWait;
        };
        const getNewTabFixOptions = () => {
            return newTabNoTitleFixOptions;
        };
        const setNewTabFixOptions = (value) => {
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

        const getWindowDataSettings = () => {
            return windowDataSettings;
        };
        const setWindowDataSettings = async (value) => {
            if (deepCopyCompare(value, windowDataSettings)) {
                windowDataSettings = value;
                return;
            }
            const oldValue = windowDataSettings;
            windowDataSettings = value;

            if (isStarted) {
                const wrappersBefore = this.array;
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
                        const keyDataCombo = {};
                        keyDataCombo[windowDataKeys.isRestored] = value.trackRestore ? true : undefined;
                        try {
                            await WindowWrapperCollection.setWindowData(keyDataCombo);
                        } catch (error) {
                            if (browser.sessions) {
                                console.error('Failed to update window session data (might be missing the "sessions" permission).', error);
                            }
                        }
                    }
                }
            }
        };
        defineProperty(this, 'windowDataSettings', getWindowDataSettings, setWindowDataSettings);

        // #endregion Window Data Settings


        // #region Listeners

        const startNeededListeners = () => {
            isStarted = true;
            const info = getGlobalFormatInfo();
            const windowInfo = getWindowDataSettings();

            const trackWindowFocus = windowInfo.inheritName || windowInfo.inheritSettings;
            const handleWindowData = (windowInfo.defaultName && windowInfo.defaultName !== '') || windowInfo.inheritName || windowInfo.inheritSettings;

            const trackTabs = info.useTabCount || info.useTotalTabCount || info.useActiveTabIndex;
            const trackNewTabs = getNewTabFix_Enabled();
            const trackWindows = info.hasText || handleWindowData || trackTabs || trackNewTabs;
            const trackActiveTab = info.useActiveTabIndex;

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

            if (trackActiveTab) {
                startActiveTabListeners();
            } else {
                if (activeTabListeners) {
                    activeTabListeners.dispose();
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

        /** @type {DisposableCollection<IDisposable>} */
        var disposables = new DisposableCollection([
            new EventListener(onTabCountChange, (wrapper) => handleEvent(() => {
                let affectedWrappers = [];

                if (getGlobalFormatInfo().useOverride) {
                    const checkFormat = (info, aWrapper) => {
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
            new EventListener(onActiveTabChange, (wrapper) => handleEvent(() => {
                let affectedWrappers = [];

                if (getGlobalFormatInfo().useOverride) {
                    const checkFormat = (info, aWrapper) => {
                        if (info.useWindowName) {
                            info = FormatPlaceholder.combineFormatInfos([info, aWrapper.formatInfo]);
                        }
                        return info.useCount || (aWrapper === wrapper && info.useActiveTabIndex);
                    };
                    affectedWrappers.push.apply(affectedWrappers, this.array.filter(aWrapper => {
                        return checkFormat(aWrapper.overrideFormatInfo.useOverride ? aWrapper.overrideFormatInfo : getFormatInfo(), aWrapper);
                    }));
                } else if (getFormatInfo().useCount) {
                    affectedWrappers.push.apply(affectedWrappers, this.array);
                } else if (getFormatInfo().useWindowName) {
                    affectedWrappers.push.apply(affectedWrappers, this.array.filter(aWrapper => aWrapper.formatInfo.useCount || (aWrapper === wrapper && (getFormatInfo().useActiveTabIndex || aWrapper.formatInfo.useActiveTabIndex))));
                } else if (getFormatInfo().useActiveTabIndex) {
                    affectedWrappers.push(wrapper);
                }
                this.updateWindowTitles(affectedWrappers);
            })),
            new EventListener(onWindowDataChange, (wrapper, dataKey, newValue) => handleEvent(() => {
                const affectedWrappers = [wrapper];
                if (getGlobalFormatInfo().useOverride) {
                    const checkFormat = (info, aWrapper) => {
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
        let timeDisposables = new DisposableCollection();

        /**
         * Wait a certain number of milliseconds. This delay can be canceled.
         *
         * @param {number} time The time in milliseconds to wait.
         * @param {null | DisposableCollection} [disposableCollection] An optional extra collection to use. If this is disposed then the wait is canceled. The wait can still be canceled even if this isn't provided.
         */
        const safeWait = async (time, disposableCollection) => {
            try {
                if (time < 0) {
                    return;
                }
                let trackedWithArgCollection = false;
                let timeout;
                try {
                    const promiseWrapper = new PromiseWrapper();

                    timeout = new Timeout(() => promiseWrapper.resolve(), time);
                    new EventListener(timeout.onDisposed, () => promiseWrapper.resolve());
                    if (!timeout.isActive) {
                        promiseWrapper.resolve();
                    }
                    timeDisposables.trackDisposables(timeout);

                    if (disposableCollection && disposableCollection instanceof DisposableCollection) {
                        trackedWithArgCollection = true;
                        disposableCollection.trackDisposables(timeout);
                    }

                    await promiseWrapper.getValue();
                } finally {
                    if (timeout) {
                        timeout.dispose();
                        timeDisposables.untrackDisposables(timeout);
                        if (trackedWithArgCollection) {
                            disposableCollection.untrackDisposables(timeout);
                        }
                    }
                }
            } catch (error) { }
        };
        /**
         * Get the wrapper for a window given its id.
         *
         * @template T
         * @param {number} windowId The id for the wanted window.
         * @param {function(WindowWrapper): T} callback A callback that will be provided a wrapper for the specified window.
         * @returns {T} the value from the callback.
         */
        const getWrapperAndDo = (windowId, callback) => {
            const wrapper = this.getWindowWrappersById(windowId);
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


            const onTabStateChange = new EventManager();
            const waitForLoadState = async (tabId, timeoutTime, onlyCompletedLoading = false, useSafeWait = true) => {
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
                                timeout.onDisposed.addListener(() => resolve());
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
            const newTabURLs = [
                'about:newtab',
                'about:home',
            ];
            /**
             * Ensure the new tab page is fixed so that the title preface is shown.
             *
             * @param {BrowserTab} tab A browser tab.
             * @param {boolean} [justCreated] `true` if the tab was created right this moment.
             */
            const handleNewPage = async (tab, justCreated = false) => {
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

                    const createTime = Date.now();


                    // #region Wait for URL:

                    let waitAttempt = 0;
                    while (tab.url === 'about:blank') {
                        waitAttempt++;
                        if (waitAttempt > 4) {
                            return;
                        }
                        if ((waitAttempt + 1) > 4) {
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

                    const reloadRequired = justCreated && tab.url === 'about:newtab';
                    if (reloadRequired) {
                        // Min time before reloading tab:
                        await safeWait(getNewTabFix_LoadWaitTime() - (Date.now() - createTime));

                        // Reload tab:
                        await browser.tabs.reload(tab.id);
                    }

                    // #endregion Reload Tab


                    if (tab.active) {
                        const reloadTime = Date.now();
                        let newStatus = tab.status;


                        // #region Ensure the tab is loaded

                        if (reloadRequired || tab.status !== 'complete') {
                            // Max wait before setting title prefix (continues on tab completing loading):
                            newStatus = await waitForLoadState(tab.id, getNewTabFix_ReloadWaitTime(), true);
                        }

                        // #endregion Ensure the tab is loaded


                        // #region Ensure tab wasn't reloaded

                        const getMinWaitTime = () => getNewTabFix_MinPrefixWait() - (Date.now() - reloadTime);
                        if (!newStatus) {
                            await safeWait(getMinWaitTime());
                        }
                        const minWaitForReloadTime = 50;
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
            const removeHandledTabId = (tabId) => {
                while (true) {
                    const index = handleTabIds.indexOf(tabId);
                    if (index < 0) {
                        break;
                    }
                    handleTabIds.splice(index, 1);
                }
            };
            const handleURLChange = async (tab) => {
                const affected = await handleNewPage(tab);
                if (!affected && isTrackingHandled) {
                    removeHandledTabId(tab.id);
                }
            };

            /** @type {DisposableCollection<IDisposable>} */
            const listeners = new DisposableCollection([
                new EventListener(browser.tabs.onUpdated, (tabId, changeInfo, tab) => {
                    if (changeInfo.status || changeInfo.discarded) {
                        const loadState = changeInfo.discarded ? 'discarded' : changeInfo.status;
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
            const trackCallback = (value) => {
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

            listeners.onDisposed.addListener(() => {
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


        let tabAddRemoveListeners = null;
        const startTabAddRemoveListeners = () => {
            if (tabAddRemoveListeners) {
                return;
            }

            const listeners = new DisposableCollection([
                new EventListener(tabOnCreated, (tab) => handleEvent((delayed) => {
                    if (delayed) return;
                    getWrapperAndDo(tab.windowId, (wrapper) => {
                        wrapper.tabAdded(tab.id);
                    });
                })),
                new EventListener(tabOnRemoved, (tabId, { windowId, isWindowClosing }) => handleEvent((delayed) => {
                    if (delayed) return;
                    getWrapperAndDo(windowId, (wrapper) => wrapper.tabRemoved(tabId));
                })),

                new EventListener(browser.tabs.onAttached, (tabId, { newWindowId, newPosition }) => handleEvent((delayed) => {
                    if (delayed) return;
                    getWrapperAndDo(newWindowId, (wrapper) => wrapper.tabAdded(tabId));
                })),
                new EventListener(browser.tabs.onDetached, (tabId, { oldWindowId, oldPosition }) => handleEvent((delayed) => {
                    if (delayed) return;
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

            for (const wrapper of this.array) {
                wrapper.forceTabUpdate();
            }
        };
        defineProperty(this, 'isTrackingTabCount', () => Boolean(tabAddRemoveListeners));


        let activeTabListeners = null;
        const startActiveTabListeners = () => {
            if (activeTabListeners) return;

            const listeners = new DisposableCollection([
                new EventListener(browser.tabs.onActivated, ({ previousTabId, tabId, windowId }) => {
                    getWrapperAndDo(windowId, (wrapper) => wrapper.checkActiveTab());
                }),
                new EventListener(browser.tabs.onMoved, (tabId, { windowId, fromIndex, toIndex }) => {
                    getWrapperAndDo(windowId, (wrapper) => wrapper.checkActiveTab());
                }),
            ]);
            disposables.trackDisposables(listeners);

            new EventListener(listeners.onDisposed, () => {
                if (listeners === activeTabListeners) {
                    activeTabListeners = null;
                }
                disposables.untrackDisposables(listeners);
            });
            activeTabListeners = listeners;

            for (const wrapper of this.array) {
                wrapper.checkActiveTab();
            }
        };


        var windowListeners = null;
        const startWindowListeners = () => {
            if (windowListeners) {
                return;
            }

            const listeners = new DisposableCollection([
                new EventListener(browser.windows.onCreated, (window) => handleEvent(() => {
                    const initialWindowData = {};

                    const winDataSettings = getWindowDataSettings();
                    initialWindowData[windowDataKeys.name] = winDataSettings.defaultName;
                    /** @type {WindowWrapper} */
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
                    this.addWindowWrappers(new WindowWrapper({
                        window,
                        blockTime: getBlockTime,
                        trackSessionRestore: winDataSettings.trackRestore,
                        initialWindowData,
                        recountTabsWhenEqualOrLessThan,
                        wasCreatedJustNow: true,
                    }));
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


        let windowFocusedListeners = null;
        /** @type {number[]} Ids of the windows that have had focus. */
        let lastFocused = [];
        let focusCacheLength = 5;
        let focusedIndex = 0;
        /**
         * Get the window id of the latest focused window.
         *
         * @param {number | number[]} [ignoredWindowIds=[]] Window ids to ignore. Will get the window that had focus before these ones.
         * @returns {null | number} The id of the window that had focus.
         */
        const getLastFocusedWindow = (ignoredWindowIds = []) => {
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
                const windowId = lastFocused[index];
                if (!ignoredWindowIds.includes(windowId)) {
                    return windowId;
                }
                index--;
                if (index === focusedIndex) {
                    return null;
                }
            }
        };
        const startWindowFocusedListeners = async () => {
            if (windowFocusedListeners) {
                return;
            }

            const lastFocusedWindow = await browser.windows.getLastFocused();
            lastFocused = [lastFocusedWindow.id];
            const listeners = new DisposableCollection([
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
            const ids = this.array.map(wrapper => wrapper.window.id);
            for (const wrapper of windowWrappers) {
                if (ids.includes(wrapper.window.id)) {
                    wrapper.dispose();
                    continue;
                }
                this.array.push(wrapper);
                this.array.sort((a, b) => a.window.id - b.window.id);
                ids.push(wrapper.window.id);

                // Wrapper event listeners:
                const wrapperListeners = new DisposableCollection([
                    new EventListener(wrapper.onTabCountChange, () => onTabCountChange.fire(wrapper)),
                    new EventListener(wrapper.onActiveTabIndexChange, () => onActiveTabChange.fire(wrapper)),
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
                onActiveTabChange.fire(wrapper);
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
            for (const wrapper of windowWrappers) {
                if (this.array.includes(wrapper)) {
                    wrapper.dispose();
                    this.array = this.array.filter(arrayWrapper => arrayWrapper !== wrapper);

                    onTabCountChange.fire(wrapper);
                    onActiveTabChange.fire(wrapper);
                    clearGlobalFormatInfo();
                }
            }
        };

        // #endregion Wrapper Add/Remove


        // #region Start & Stop

        let queuedCallbacks = [];
        let isStarted = false;
        let isDisposed = false;

        // eslint-disable-next-line valid-jsdoc
        /** Handle an event.
         *
         * Might be queued if we are currently building new WindowWrappers for
         * all windows.
         * @param {(delayed: boolean) => any} callback Callback that handles the
         * event */
        const handleEvent = (callback) => {
            if (isDisposed) {
                return;
            }
            if (isStarted) {
                callback(false);
            } else {
                queuedCallbacks.push(callback);
            }
        };

        /** Get information for all windows. */
        // eslint-disable-next-line no-underscore-dangle
        const _start = async () => {
            if (isDisposed) {
                return;
            }

            isStarted = false;
            const windows = await browser.windows.getAll({ populate: true });

            const winDataSettings = getWindowDataSettings();
            this.addWindowWrappers(windows.map(window => new WindowWrapper({
                window,
                blockTime: getBlockTime,
                trackSessionRestore: winDataSettings.trackRestore,
                recountTabsWhenEqualOrLessThan,
            })));

            for (const callback of queuedCallbacks) {
                if (isDisposed) {
                    break;
                }
                callback(true);
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

    // eslint-disable-next-line valid-jsdoc
    /**
     * Get the `WindowWrapper` for a certain window id.
     *
     * @template {number | number[]} I
     * @param {I} windowIds A window id or an array of window ids.
     * @returns { I extends number[] ? WindowWrapper[] : WindowWrapper } If `windowIds` was an array then an array of window wrappers; otherwise the window wrapper for the specified id.
     * @memberof WindowWrapperCollection
     */
    getWindowWrappersById(windowIds) {
        if (!windowIds && windowIds !== 0) {
            return;
        }
        let oneValue = false;
        if (!Array.isArray(windowIds)) {
            windowIds = /** @type {any} */ ([windowIds]);
            oneValue = true;
        }
        const wrappers = [];
        for (const windowId of /** @type {number[]} */ (windowIds)) {
            const possible = this.array.filter(wrapper => wrapper.window.id === windowId);
            if (possible.length === 0) {
                wrappers.push(null);
            } else {
                wrappers.push(possible[0]);
            }
        }
        if (oneValue) {
            // @ts-ignore
            return wrappers[0];
        } else {
            // @ts-ignore
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

        const cachedFormat = this.titleFormat;
        let cachedTotalTabCount = '';
        if (this.formatInfo.useTotalTabCount) {
            cachedTotalTabCount = String(WindowWrapperCollection.calculateTotalTabCount(this.windowFilter(this, filterType.tabCount)));
        }

        const allowed = this.windowFilter(this, filterType.title);
        const updated = [];
        const usedPrefixes = allowed
            .filter((wrapper) => !windowWrappers.includes(wrapper))       // Only include wrappers that are not going to be updated.
            .map(wrapper => (wrapper.lastTitlePrefix && wrapper.cachedUsedPrefixForCountPlaceholder) || ''); // Get the last prefix format used for the %Count% placeholder.

        for (const wrapper of this.array) {
            if (!windowWrappers.includes(wrapper)) {
                continue;
            }

            updated.push(wrapper);

            if (!allowed.includes(wrapper)) {
                wrapper.clearPrefix();
                continue;
            }

            const overrides = wrapper.overrideFormatInfo.useOverride ? wrapper.windowSettings : null;

            let prefix = cachedFormat;
            let useIfWindowName = this.formatInfo.useIfWindowName;
            if (overrides && overrides.windowPrefixFormat.override) {
                useIfWindowName = wrapper.overrideFormatInfo.useIfWindowName;
                prefix = overrides.windowPrefixFormat.value;
            }


            const applyIfWindowPlaceholder = (prefix) => {
                if (useIfWindowName) {
                    return formatPlaceholders.ifWindowName.apply(prefix, (arg1, arg2) => wrapper.windowName ? arg1 : arg2);
                } else {
                    return prefix;
                }
            };
            const applyCommonPlaceholders = (prefix) => {
                return (prefix
                    .replace(formatPlaceholders.tabCount.regExp, wrapper.tabCount)
                    .replace(formatPlaceholders.totalTabCount.regExp, cachedTotalTabCount)
                    .replace(formatPlaceholders.activeTabIndex.regExp, wrapper.activeTabIndex + 1)


                    .replace(formatPlaceholders.firefoxVersion.regExp, browserInfo.version)
                    .replace(formatPlaceholders.firefoxBuildId.regExp, browserInfo.buildID)

                    .replace(formatPlaceholders.platformOS.regExp, platformInfo.os)
                    .replace(formatPlaceholders.platformArchitecture.regExp, platformInfo.arch)
                    .replace(formatPlaceholders.comma.regExp, ',')
                    .replace(formatPlaceholders.percent.regExp, '%')
                );
            };

            prefix = applyIfWindowPlaceholder(prefix);
            prefix = prefix.replace(formatPlaceholders.windowName.regExp, wrapper.windowName);

            // Handle "if regex match" placeholder
            prefix = formatPlaceholders.ifRegexMatch.apply(prefix, (textToSearch, regexText, regexFlags, trueText, falseText) => {
                textToSearch = applyCommonPlaceholders(textToSearch);
                regexText = applyCommonPlaceholders(regexText);
                regexFlags = applyCommonPlaceholders(regexFlags);
                try {
                    const regex = new RegExp(regexText, regexFlags);
                    return regex.test(textToSearch) ? trueText : falseText;
                } catch (error) {
                    console.error('Failed to create a regular expression for: ', regexText, '\nwith the flags: ', regexFlags, '\nto search the text: ', textToSearch, '\nerror: ', error);
                    return falseText;
                }
            });

            // Ensure unique prefix:
            if (formatPlaceholders.count.test(prefix)) {
                const initialPrefix = prefix;
                let count = 1;
                do {
                    prefix = initialPrefix.replace(formatPlaceholders.count.regExp, count++);
                } while (usedPrefixes.some(usedPrefix => usedPrefix === prefix));
            }
            wrapper.cachedUsedPrefixForCountPlaceholder = prefix;
            usedPrefixes.push(prefix);

            prefix = applyCommonPlaceholders(prefix);

            wrapper.setTitlePrefix(prefix);
        }
    }

    static calculateTotalTabCount(windowWrappers) {
        let tabCount = 0;
        for (const windowWrapper of windowWrappers) {
            tabCount += windowWrapper.tabCount;
        }
        return tabCount;
    }

    static async setWindowData(dataKeyValueCombos) {
        if (!dataKeyValueCombos) {
            return;
        }
        const dataKeys = Object.keys(dataKeyValueCombos);
        if (dataKeys.length === 0) {
            return;
        }
        const windows = await browser.windows.getAll();
        const removeData = async (windowId, dataKey) => {
            await browser.sessions.removeWindowValue(windowId, dataKey);
            onWindowDataUpdate.fire(windowId, dataKey, undefined);
        };
        const setData = async (windowId, dataKey, value) => {
            await browser.sessions.setWindowValue(windowId, dataKey, value);
            onWindowDataUpdate.fire(windowId, dataKey, value);
        };
        const promises = [];
        for (const window of windows) {
            for (const key of dataKeys) {
                const value = dataKeyValueCombos[key];
                promises.push(value === undefined ? removeData(window.id, key) : setData(window.id, key, value));
            }
        }
        await Promise.all(promises);
    }
}


export class WindowWrapper {
    /**
     * Creates an instance of WindowWrapper.
     * @param {Object} Params Parameters
     * @param {BrowserWindow} Params.window Window data.
     * @param {number | function(): number} Params.blockTime Minimum time between expensive operations.
     * @param {boolean} Params.trackSessionRestore Whether to track if a window is a re-opened closed window or a newly created one.
     * @param {Object} Params.initialWindowData Default window data.
     * @param {number} Params.recountTabsWhenEqualOrLessThan Set initial tab limit for when to perform recounts.
     * @param {boolean} Params.wasCreatedJustNow `true` if the window was just created and so we know that we haven't missed any tab events.
     * @memberof WindowWrapper
     */
    constructor({ window, blockTime, trackSessionRestore, initialWindowData = {}, recountTabsWhenEqualOrLessThan = 100, wasCreatedJustNow = false }) {
        if (!initialWindowData) {
            initialWindowData = {};
        }

        this.window = window;

        /** @type {number[]} Ids of tabs that were last observed being in this
         * window. Simplified version of `this.window.tabs`. */
        this._lastSeenTabIds = this.window.tabs && Array.isArray(this.window.tabs) ? this.window.tabs.map(tab => tab.id) : [];

        // Don't keep tab info around since we don't use it and it takes up
        // memory (especially if we are allowed to observe URLs and titles using
        // the `tabs` permission);
        delete this.window.tabs;

        // #region Dispose

        this._disposed = false;
        this._onDisposed = new EventManager();

        // #endregion Dispose

        // #region Tab count

        /** @type {number} When the tab count is less than or equal to this
         * number then we should always recount tabs after a tab count change to
         * ensure we remain in sync with the browser even in the face of
         * possible bugs.
         *
         * Note that if this is a negative value then we should always recount
         * and if it is `0` then we should never recount. */
        this._recountTabsWhenEqualOrLessThan = recountTabsWhenEqualOrLessThan;
        /** If this is `true` then it will force a single recount even if it
         * wouldn't be allowed because of `_recountTabsWhenEqualOrLessThan`. */
        this._forceRecount = false;

        this._tabCount = 1;
        this._updateTabCountFromStoredTabs();

        /** Indicates if we are currently tracking recently removed tabs.
         *
         * If this is `false` then we should wait at least 100 ms and preferably
         * longer before making a tabs.query operation since they might contain
         * removed tabs. */
        this._ignoredTabIds_enabled = Boolean(wasCreatedJustNow);
        /** @type {Set<number>} Tab ids that have been closed or moved to a
         * different window. The browser might still return those tabs from
         * `browser.tabs.query` for a small time after they were moved/closed.
         *
         * This seems to only affect closed tabs and not moved tabs (but not
         * entirely sure about that). From some basic testing the `tabs.query`
         * API's result will include closed tabs for about 100 milliseconds
         * after they were removed. */
        this._ignoredTabIds = new Set();
        /** @type {null | Set<number>} Used to keeps track of ids of tabs that
         * were removed while the `_updateTabs` method were doing a
         * `browser.tabs.query` operation.
         *
         * Any tab ids in this set might have been included in the query result
         * even though they are actually closed. */
        this._duringUpdate_removedTabIds = null;
        /** @type {null | Set<number>} Used to keeps track of ids of tabs that
         * were added while the `_updateTabs` method were doing a
         * `browser.tabs.query` operation.
         *
         * Any tab ids in this set might not have been created until after the
         * `browser.tabs.query` operation was started and so might not have been
         * included in the result.
         *
         * In Firefox version `95.0.2` on Windows 10 this field is quite
         * unnecessary since `browser.tabs.query` results always seem to include
         * tabs that were created while the query was in progress. Even so we
         * will keep it in order to remain compatible with future version of
         * Firefox or in case other platforms behave differently. */
        this._duringUpdate_addedTabIds = null;
        /** Queues tab recounts. */
        this._updateManager = new RequestManager(
            async () => {
                await this._updateTabs();
            },
            blockTime,
            false,
        );
        this._onTabUpdate = new EventManager();
        this._onTabCountChange = new EventManager();

        // #endregion Tab count


        // #region Active Tab Index

        this._activeTabIndexChange = new EventManager();
        this._activeTab = null;
        this._activeTabUpdateManager = new RequestManager(
            async () => {
                this.activeTab = (await browser.tabs.query({ active: true, windowId: this.window.id }))[0] || null;
            },
            blockTime,
            false,
        );

        // #endregion Active Tab Index


        // #region Session data for window

        /** This will be notified when the window's session data has been changed. */
        this._onWindowDataChange = new EventManager();
        this._onFormatInfoChange = new EventManager();
        /** This notifies about session data changes and will be invoked from outside this object using the `dataUpdate` method. */
        this._onDataUpdate = new EventManager();
        this.isRestoredWindow = this._handleRestoreData(trackSessionRestore);
        this._cachedFormatInfo = null;
        this._cachedOverrideFormatInfo = null;

        // #endregion Session data for window


        // #region Title prefix

        this._lastTitlePrefix = '';
        /** Indicates that the next update of the window's prefix should ignore the cached value. */
        this._forceTitleUpdate = false;
        this._wantedTitlePrefix = '';
        this._titleUpdateManager = new RequestManager(
            async () => {
                const value = this._wantedTitlePrefix;
                if (this._lastTitlePrefix === value && !this._forceTitleUpdate) {
                    return;
                }
                this._forceTitleUpdate = false;
                if (!value || value === '') {
                    await WindowWrapper.clearWindowPrefixes(this.window.id);
                    this._lastTitlePrefix = '';
                } else {
                    await WindowWrapper.setWindowPrefix(this.window.id, value);
                    this._lastTitlePrefix = value;
                }
            },
            blockTime,
            false,
        );

        // #endregion Title prefix


        // Invalidate cached format info when session data changes:
        this._onWindowDataChange.addListener((wrapper, dataKey, value) => {
            if (dataKey === windowDataKeys.name) {
                this._clearFormatInfo();
            }
            if (dataKey === windowDataKeys.settings) {
                this._clearOverrideFormatInfo();
            }
        });


        // #region Generate get and set helpers for session data properties

        const createDataMonitor = (valueTest, dataKey, initialValue) => {
            initialValue = (async () => deepCopy(await initialValue))();
            const defaultData = valueTest();
            let data = defaultData;
            let dataChanged = false;
            (async () => {
                let value = undefined;
                try {
                    if (browser.sessions) {
                        value = await browser.sessions.getWindowValue(window.id, dataKey);
                    }
                } catch (error) {
                    console.error('Failed to get session data for window.', error);
                }
                if (dataChanged) {
                    return;
                }
                if (value === undefined) {
                    initialValue = await initialValue;
                    if (dataChanged || initialValue === undefined || (await this.isRestoredWindow)) {
                        return;
                    }
                    updateData(initialValue);
                } else {
                    setData(value);
                }
            })();
            const getData = () => {
                return deepCopy(data);
            };
            const setData = (value) => {
                value = deepCopy(value);
                dataChanged = true;
                value = valueTest(value);
                if (deepCopyCompare(value, data)) {
                    data = value;
                    return;
                }
                data = value;

                this._onWindowDataChange.fire(this, dataKey, value);
            };
            const updateData = async (value) => {
                value = valueTest(value);
                try {
                    if (browser.sessions) {
                        if (deepCopyCompare(value, defaultData)) {
                            await browser.sessions.removeWindowValue(window.id, dataKey);
                        } else {
                            await browser.sessions.setWindowValue(window.id, dataKey, value);
                        }
                    }
                } catch (error) {
                    console.error('Failed to update session data for window.', error);
                }
                setData(value);
            };
            this._onDataUpdate.addListener((key, newValue) => {
                if (key === dataKey) {
                    setData(newValue);
                }
            });
            return {
                getData,
                setData,
            };
        };

        this._windowNameSessionData = createDataMonitor((value) => {
            if (!value) {
                return '';
            }
            return value;
        }, windowDataKeys.name, initialWindowData[windowDataKeys.name]);

        this._windowSettingsSessionData = createDataMonitor((value) => {
            if (!value || typeof value !== 'object') {
                value = {};
            }
            const defaultValues = {
                windowPrefixFormat: '',
            };
            for (const key of Object.keys(defaultValues)) {
                if (!value[key]) {
                    value[key] = {};
                }
                const overrideSetting = value[key];
                if (!overrideSetting.value) {
                    overrideSetting.value = defaultValues[key];
                }
                if (defaultValues[key] === Boolean(defaultValues[key])) {
                    overrideSetting.value = Boolean(overrideSetting.value);
                }
                overrideSetting.override = Boolean(overrideSetting.override);
            }
            return value;
        }, windowDataKeys.settings, initialWindowData[windowDataKeys.settings]);

        // #endregion Generate get and set helpers for session data properties


        // Ensure we have a correct tab count when initialized (note that if
        // `wasCreatedJustNow` is false then it will take about 2 seconds before
        // we get the tab count):
        this.forceTabUpdate();
    }


    // #region Tab Count

    _checkIfShouldRecount() {
        if (this._forceRecount || this._recountTabsWhenEqualOrLessThan < 0 || this.tabCount <= this._recountTabsWhenEqualOrLessThan) {
            // Do recount:
            return true;
        } else {
            // No recount:
            this._ignoredTabIds_enabled = false;
            this._ignoredTabIds.clear();

            return false;
        }
    }

    async _updateTabs() {
        if (this.isDisposed) return;

        // Don't do recounts when we have too many tabs:
        if (!this._checkIfShouldRecount()) return;

        // If we weren't tracking recently removed tabs then start now:
        if (!this._ignoredTabIds_enabled) {
            this._ignoredTabIds_enabled = true;
            // Should wait at least 100 ms to ensure no recently removed tabs
            // are returned by the `query` API:
            await delay(2000);
            if (this.isDisposed || !this._ignoredTabIds_enabled) return;

            // Any tab count invalidation that was made while we were waiting
            // will be dealt with now:
            this._updateManager.validate();
        }

        // Track any tabs that are added or removed while we are waiting:
        if (this._duringUpdate_removedTabIds || this._duringUpdate_addedTabIds) throw new Error('Tried to update tab count while such an update was already in progress');
        this._duringUpdate_removedTabIds = new Set();
        this._duringUpdate_addedTabIds = new Set();
        try {
            /** @type {BrowserTab[]} */
            const windowTabs = await browser.tabs.query({ windowId: this.window.id });
            if (this.isDisposed || !this._ignoredTabIds_enabled) return;

            // Handle ignored tabs:
            /** Tab ids that didn't exist in the gathered tabs.
             *
             * Initially set to remove all ignored tabs, but then we remove the
             * ones we want to keep from it. */
            const ignoredTabIdsToRemove = (this._ignoredTabIds.size > 0) ? new Set(this._ignoredTabIds) : null;
            if (ignoredTabIdsToRemove) {
                // Don't remove tabs that started being ignored after we made
                // the tab query (they might somehow show up in the next query
                // if they were added just before they were removed):
                for (const newlyRemovedId of this._duringUpdate_removedTabIds.values()) {
                    ignoredTabIdsToRemove.delete(newlyRemovedId);
                }
            }
            {
                let index = 0;
                while (index < windowTabs.length) {
                    const tab = windowTabs[index];

                    // If the tab is included in query result then it is not "newly added":
                    this._duringUpdate_addedTabIds.delete(tab.id);

                    if (this._ignoredTabIds.has(tab.id)) {
                        // Track ignored ids that still exist:
                        if (ignoredTabIdsToRemove) {
                            ignoredTabIdsToRemove.delete(tab.id);
                        }
                        // Remove ignored tabs:
                        windowTabs.splice(index, 1);
                    } else {
                        index++;
                    }
                }
            }
            // Only keep ignoring tab ids that are still in use.
            if (ignoredTabIdsToRemove) {
                for (const idToRemove of ignoredTabIdsToRemove.values()) {
                    this._ignoredTabIds.delete(idToRemove);
                }
            }
            // Update tab info:
            const oldTabCount = this.tabCount;
            this._lastSeenTabIds = windowTabs.map(tab => tab.id);
            this._updateTabCountFromStoredTabs();
            // Count any tabs that were created during the query operation as
            // well (even if they weren't included in the returned result):
            this._tabCount += this._duringUpdate_addedTabIds.size;

            // Notify event listeners:
            const newTabCount = this.tabCount;
            this._onTabUpdate.fire(this);
            if (oldTabCount !== newTabCount) {
                this._onTabCountChange.fire(this, oldTabCount, newTabCount);
            }
        } finally {
            // Its okay to do this after an await or event fire since the update
            // manager ensure that _updateTabs isn't called multiple times
            // concurrently.
            this._duringUpdate_removedTabIds = null;
            this._duringUpdate_addedTabIds = null;
        }

        if (this._forceRecount) {
            this._forceRecount = false;
            // Might stop tracking recently removed tabs:
            this._checkIfShouldRecount();
        }
    }
    _updateTabCountFromStoredTabs() {
        let tabCount = this._lastSeenTabIds.length;

        if (tabCount < 0)
            tabCount = 0;

        this._tabCount = tabCount;
    }

    get recountTabsWhenEqualOrLessThan() {
        return this._recountTabsWhenEqualOrLessThan;
    }
    set recountTabsWhenEqualOrLessThan(value) {
        const wanted = Number(value);
        if (isNaN(wanted)) throw new Error(`NaN (or actually ${value}) is not a valid "recountTabsWhenEqualOrLessThan" value`);
        if (this._recountTabsWhenEqualOrLessThan === wanted) return;
        this._recountTabsWhenEqualOrLessThan = wanted;

        if (this._checkIfShouldRecount() && !this._ignoredTabIds_enabled) {
            // We had stopped using recounts so start again immediately:
            this._updateManager.forceUpdate();
        }
    }

    get tabCount() {
        // Never show less than 1 tab (even though that can actually happen in
        // special circumstances):
        return this._tabCount > 0 ? this._tabCount : 1;
    }
    /** A tab was created in this window or moved to it.
     * @param {number} tabId The id of the added tab. */
    tabAdded(tabId) {
        if (this.isDisposed) return;

        // Track recently added/removed tabs:
        if (this._ignoredTabIds_enabled) {
            this._ignoredTabIds.delete(tabId);
            if (this._duringUpdate_removedTabIds) {
                this._duringUpdate_removedTabIds.delete(tabId);

                this._duringUpdate_addedTabIds.add(tabId);
            }
        }

        // Update tab count:
        const oldCount = this.tabCount;
        this._tabCount++;
        const newCount = this.tabCount;

        if (oldCount !== newCount) {
            this._onTabCountChange.fire(this, oldCount, newCount);
        }

        // Get all tabs from API to avoid getting out of sync (especially in
        // early versions of Firefox this could easily happen due to bugs):
        if (this._checkIfShouldRecount()) {
            this._updateManager.invalidate();
        }
    }
    /** A tab was closed in this window or a tab was moved away from it to a
     * different window.
     * @param {number} tabId The id of the removed tab. */
    tabRemoved(tabId) {
        if (this.isDisposed) return;

        // Track recently added/removed tabs:
        if (this._ignoredTabIds_enabled) {
            this._ignoredTabIds.add(tabId);
            if (this._duringUpdate_removedTabIds) {
                this._duringUpdate_removedTabIds.add(tabId);

                this._duringUpdate_addedTabIds.delete(tabId);
            }
        }

        // Test how long an ignored tab id can be returned by `browser.tabs.query`:
        /*
        const removedAt = Date.now();
        const makeQuery = async () => {
            const queriedAt = Date.now();
            const tabs = await browser.tabs.query({ windowId: this.window.id }).catch(() => null);
            const [tab,] = tabs.filter(tab => tab.id === tabId);
            console.log(tabId, ': Removed tab quired after', queriedAt - removedAt, 'ms, result: ', tab);
            if (!tab) {
                clearInterval(intervalId);
            }
        };
        const intervalId = setInterval(makeQuery, 1);
        makeQuery();
        */

        // Update tab count:
        const oldCount = this.tabCount;
        this._tabCount--;
        if (this._tabCount < 0) {
            // Can actually reach 0 tabs if for example
            // `browser.tabs.closeWindowWithLastTab` is set to `false` via the
            // `about:config` URL.
            this._tabCount = 0;
        }
        const newCount = this.tabCount;

        if (oldCount !== newCount) {
            this._onTabCountChange.fire(this, oldCount, newCount);
        }

        // Get all tabs from API to avoid getting out of sync (especially in
        // early versions of Firefox this could easily happen due to bugs):
        if (this._checkIfShouldRecount()) {
            this._updateManager.invalidate();
        }
    }

    get onTabUpdate() {
        return this._onTabUpdate.subscriber;
    }
    get onTabCountChange() {
        return this._onTabCountChange.subscriber;
    }

    forceTabUpdate() {
        this._forceRecount = true;
        this._updateManager.forceUpdate();
    }
    unblockTabUpdate() {
        this._updateManager.unblock();
    }

    // #endregion Tab Count


    // #region Active Tab

    checkActiveTab() {
        this._activeTabUpdateManager.invalidate();
    }

    /**
     * 0 based index of the window's active tab.
     *
     * @readonly
     * @memberof WindowWrapper
     */
    get activeTabIndex() {
        if (this._activeTab) {
            return this._activeTab.index;
        } else {
            return 0;
        }
    }

    get onActiveTabIndexChange() {
        return this._activeTabIndexChange.subscriber;
    }

    get activeTab() {
        return this._activeTab;
    }
    set activeTab(value) {
        const previousIndex = this.activeTabIndex;
        this._activeTab = value;

        if (previousIndex != this.activeTabIndex) {
            this._activeTabIndexChange.fire(this);
        }
    }

    // #endregion Active Tab


    // #region Window Data

    dataUpdate(key, newValue) {
        this._onDataUpdate.fire(key, newValue);
    }

    async _handleRestoreData(tracking) {
        let isTracked = false;
        if (!browser.sessions) return false;
        try {
            try {
                if (tracking) {
                    isTracked = await browser.sessions.getWindowValue(this.window.id, windowDataKeys.isRestored);
                    return isTracked;
                } else {
                    return false;
                }
            } finally {
                if (tracking) {
                    if (!isTracked) {
                        browser.sessions.setWindowValue(this.window.id, windowDataKeys.isRestored, true);
                    }
                } else {
                    browser.sessions.removeWindowValue(this.window.id, windowDataKeys.isRestored);
                }
            }
        } catch (error) {
            console.error('Failed to get or update restored window session data.', error);
            return false;
        }
    }

    get trackSessionRestore() {
        return this._trackSessionRestore;
    }
    set trackSessionRestore(value) {
        value = Boolean(value);
        if (Boolean(this._trackSessionRestore) === value) {
            return;
        }
        this._trackSessionRestore = value;
        this.isRestoredWindow = Promise.resolve(this.isRestoredWindow).finally(() => this._handleRestoreData(this._trackSessionRestore));
    }

    /**
     * This will be notified when this window's session data is changed.
     *
     * @readonly
     * @memberof WindowWrapper
     */
    get onDataChange() {
        return this._onWindowDataChange.subscriber;
    }

    get formatInfo() {
        if (!this._cachedFormatInfo) {
            this._cachedFormatInfo = FormatPlaceholder.createFormatInfo(this.windowName);
            this._cachedFormatInfo.useIfWindowName = false;
        }
        return this._cachedFormatInfo;

    }

    _clearFormatInfo() {
        const oldInfo = this.formatInfo;
        this._cachedFormatInfo = null;
        const newInfo = this.formatInfo;
        if (!deepCopyCompare(oldInfo, newInfo)) {
            this._onFormatInfoChange.fire();
        }
    }
    get overrideFormatInfo() {
        if (!this._cachedOverrideFormatInfo) {
            const overrideSettings = this.windowSettings;
            this._cachedOverrideFormatInfo = FormatPlaceholder.createFormatInfo(overrideSettings.windowPrefixFormat.override ? overrideSettings.windowPrefixFormat.value : '');
            if (overrideSettings.windowPrefixFormat.override) {
                this._cachedOverrideFormatInfo.useOverride = true;
            }
        }
        return this._cachedOverrideFormatInfo;
    }
    _clearOverrideFormatInfo() {
        const oldInfo = this.overrideFormatInfo;
        this._cachedOverrideFormatInfo = null;
        const newInfo = this.overrideFormatInfo;
        if (!deepCopyCompare(oldInfo, newInfo)) {
            this._onFormatInfoChange.fire();
        }
    }

    get onFormatInfoChange() {
        return this._onFormatInfoChange.subscriber;
    }

    get windowName() {
        return this._windowNameSessionData.getData();
    }
    set windowName(value) {
        this._windowNameSessionData.setData(value);
    }

    get windowSettings() {
        return this._windowSettingsSessionData.getData();
    }
    set windowSettings(value) {
        this._windowSettingsSessionData.setData(value);
    }

    // #endregion Window Data


    // #region Title

    async clearPrefix() {
        this._wantedTitlePrefix = '';
        this._titleUpdateManager.forceUpdate();
    }

    get lastTitlePrefix() {
        return this._lastTitlePrefix;
    }
    set lastTitlePrefix(value) {
        this._lastTitlePrefix = value;
    }

    /**
     * Figure out the current title preface for this window. This can be used to determine the title preface that was set by another extension.
     *
     * @returns {Promise<null | string>} The title preface for this window.
     * @memberof WindowWrapper
     */
    async getTitlePrefix() {
        if (!this.window) {
            // No window.
            return null;
        }
        // Title should be: "[prefix][tab title] - [brand]"
        // or if the tab has no title: "[brand]"
        let title = this.window.title;
        if (!title && title !== '') {
            // No window title property. Needs 'tabs' permission.
            return null;
        }

        // Remove brand from title:
        const separatorIndex = title.lastIndexOf(' - ');
        if (separatorIndex < 0) {
            // Current tab has no title and title prefix is therefore not shown.
            return null;
        } else {
            title = title.substr(0, separatorIndex);
        }

        // Remove tab title from window title:
        const [currentTab,] = await browser.tabs.query({ windowId: this.window.id, active: true });
        if (currentTab.title && currentTab.title !== '') {
            const tabTitleIndex = title.lastIndexOf(currentTab.title);
            if (tabTitleIndex >= 0) {
                title = title.substr(0, tabTitleIndex);
            } else {
                // Probably changed active tab, or tab changed title...
            }
        }

        return title;
    }
    async setTitlePrefix(value) {
        this._wantedTitlePrefix = value || '';
        this._titleUpdateManager.invalidate();
    }

    forceSetTitlePrefix(forceUpdateNow = true) {
        // This will cause the next request to not check the cached prefix:
        this._forceTitleUpdate = true;

        if (forceUpdateNow) {
            // Start the next update request ASAP:
            this._titleUpdateManager.forceUpdate();
        } else {
            this._titleUpdateManager.invalidate();
        }
    }
    unblockTitleUpdate() {
        this._titleUpdateManager.unblock();
    }

    // #endregion Title


    // #region Dispose

    dispose() {
        if (this.isDisposed) {
            return;
        }
        this._disposed = true;
        this._updateManager.dispose();
        this._titleUpdateManager.dispose();
        this._activeTabUpdateManager.dispose();
        this._onDisposed.fire(this);

    }
    get isDisposed() {
        return this._disposed;
    }
    get onDisposed() {
        return this._onDisposed.subscriber;
    }

    // #endregion Dispose


    static async clearWindowPrefixes(windowIds = null) {
        if (!windowIds && windowIds !== 0) {
            const windows = await browser.windows.getAll();
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
