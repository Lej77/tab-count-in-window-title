'use strict';

import {
  settings,
  settingsTracker,
  windowDataKeys,
  messageTypes,
} from '../common/common.js';

import {
  EventManager,
  EventListener,
} from '../common/events.js';

import {
  DisposableCollection,
} from '../common/disposables.js';

import {
  ToolbarPermissionRequest,
} from '../common/permissions.js';

import {
  PortManager,
} from '../common/connections.js';

import {
  filterType,
  WindowWrapper,
  WindowWrapperCollection,
} from '../background/window-wrapper.js';


/**
 * @typedef {import('../common/utilities.js').BrowserWindow} BrowserWindow
 */


// Notifications for changes in permissions or session data isn't provided by the extension API yet so we define our own and make sure to invoke them when we do anything that could change them:
export const onWindowDataUpdate = new EventManager();
export const onPermissionsChange = new EventManager();

// Firefox 77 have permission events!
try {
  if (browser.permissions.onAdded) {
    browser.permissions.onAdded.addListener((permissions) => {
      onPermissionsChange.fire(permissions, true);
    });
  }
  if (browser.permissions.onRemoved) {
    browser.permissions.onRemoved.addListener((permissions) => {
      onPermissionsChange.fire(permissions, false);
    });
  }
} catch (error) {
  console.error('Failed to listen to permission events.', error);
}


export let browserInfo = browser.runtime.getBrowserInfo();
export let platformInfo = browser.runtime.getPlatformInfo();


const waitForLoad = async () => {
  browserInfo = await browserInfo;
  platformInfo = await platformInfo;
  await settingsTracker.start;
};


const createWindowFilter = () => {
  const ignorePrivate_Tabs = settings.ignorePrivateWindows;
  const ignorePrivate_Titles = settings.dontSetPrivateWindowTitles;
  const ignorePopupWindows = settings.dontSetWindowTitlesForPopups;

  return (collection, filter) => {
    const ignorePrivate = (filter === filterType.tabCount) ? ignorePrivate_Tabs : ignorePrivate_Titles;
    return collection.array.filter(wrapper => {
      /** @type {BrowserWindow} */
      const window = wrapper.window;
      if (ignorePrivate && window.incognito) {
        // Ignore private windows for this operation (set title preface / count tabs):
        return false;
      }
      if (filter === filterType.title && ignorePopupWindows && window.type !== 'normal') {
        // Don't set popup window's title prefix.
        return false;
      }
      return true;
    });
  };
};
const createNewTabFixOptions = () => {
  return {
    isEnabled: settings.newTabNoTitleWorkaround_Enabled,
    trackHandled: settings.newTabNoTitleWorkaround_TrackHandledTabs,

    loadWait: settings.newTabNoTitleWorkaround_LoadWaitInMilliseconds,
    minPrefixWait: settings.newTabNoTitleWorkaround_MinPrefixWaitInMilliseconds,
    reloadWait: settings.newTabNoTitleWorkaround_ReloadWaitInMilliseconds,
  };
};
const createWindowDataSettings = () => {
  return {
    defaultName: settings.windowDefaultName,
    inheritName: settings.windowInheritName,
    inheritSettings: settings.windowInheritSettings,

    trackRestore: settings.windowTrackSessionRestore,
  };
};

let windowWrapperCollection;
const startTabCounter = async () => {
  await waitForLoad();
  if (!windowWrapperCollection && settings.isEnabled) {
    windowWrapperCollection = new WindowWrapperCollection(
      settings.timeBetweenUpdatesInMilliseconds,
      settings.windowPrefixFormat,
      createWindowFilter(),
      createNewTabFixOptions(),
      createWindowDataSettings(),
    );
    windowWrapperCollection.recountTabsWhenEqualOrLessThan = settings.recountTabsWhenEqualOrLessThan;
  }
};
const stopTabCounter = () => {
  if (windowWrapperCollection) {
    windowWrapperCollection.stop();
  }
  windowWrapperCollection = null;
};

new EventListener(settingsTracker.onChange, (changes) => {
  if (changes.isEnabled) {
    if (settings.isEnabled) {
      startTabCounter();
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
    windowWrapperCollection.titleFormat = settings.windowPrefixFormat;
  }
  if (changes.timeBetweenUpdatesInMilliseconds) {
    windowWrapperCollection.blockTime = settings.timeBetweenUpdatesInMilliseconds;
  }
  if (changes.recountTabsWhenEqualOrLessThan) {
    windowWrapperCollection.recountTabsWhenEqualOrLessThan = settings.recountTabsWhenEqualOrLessThan;
  }
  if (
    changes.ignorePrivateWindows ||
    changes.dontSetPrivateWindowTitles ||
    changes.dontSetWindowTitlesForPopups
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



const portManager = new PortManager();
onPermissionsChange.addListener(function () {
  portManager.fireEvent('permissionChanged', Array.from(arguments));

  // Restart everything since "sessions" permission might cause a lot of changes to prefixes:
  stopTabCounter();
  startTabCounter();
});


const runtimeListeners = new DisposableCollection([
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
        const dataKeyValueCombos = {};
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