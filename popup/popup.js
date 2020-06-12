'use strict';

import {
  messagePrefix,
  setTextMessages,
  setMessagePrefix,
  toggleClass,
} from '../ui/utilities.js';

import {
  createCollapsableArea,
  AnimationInfo,
} from '../ui/collapsable.js';

import {
  createCheckBox,
} from '../ui/basic-components.js';

import {
  settings,
  settingsTracker,
  formatPlaceholders,
  FormatPlaceholder,
  messageTypes,
  windowDataKeys,
  debug,
  quickLoadSetting,
} from '../common/common.js';

import {
  delay,
  RequestManager,
} from '../common/delays.js';

import {
  deepCopyCompare,
  deepCopy,
  defineProperty,
} from '../common/utilities.js';

import {
  EventListener,
  EventManager,
} from '../common/events.js';


setMessagePrefix('message_');


// Load settings related to styling immediately:

quickLoadSetting('popupPage_width')
  .then(popupPage_width => {
    if (popupPage_width >= 0)
      document.body.style.width = popupPage_width + 'px';
  })
  .catch(error => console.error('Failed to apply popup width setting.', error));
quickLoadSetting('popupPage_disableDarkTheme')
  .then(disableDarkTheme => {
    if (disableDarkTheme) {
      document.documentElement.classList.remove('support-dark-theme');
    }
  })
  .catch(error => console.error('Failed to disable popup dark theme support.', error));

const browserInfo = browser.runtime.getBrowserInfo();
browserInfo
  .then(browserInfo => {
    const [majorVersion,] = browserInfo.version.split('.');
    if (majorVersion < 65) {
      document.documentElement.classList.add('legacy-force-word-wrap');
    }
  })
  .catch(error => console.error('Failed to load browser info to fix styling.', error));


class WindowSessionDataManager {
  constructor(window, dataKey, loadedCallback, valueTest) {
    if (!valueTest || typeof valueTest !== 'function') {
      valueTest = (value) => value;
    }
    let defaultValue = valueTest();

    var getWindowValue = async () => {
      window = await window;
      let rawValue = await browser.sessions.getWindowValue(window.id, dataKey);
      return valueTest(rawValue);
    };
    var loadedValue = getWindowValue();
    var valueChanged = false;
    var currentValue = loadedValue;
    loadedValue.then((value) => {
      if (value && !valueChanged) {
        if (loadedCallback && typeof loadedCallback === 'function') {
          loadedCallback(value);
        }
      }
    });
    let valueUpdater = new RequestManager(
      async (value) => {
        value = valueTest(value);
        currentValue = await currentValue;
        if (deepCopyCompare(currentValue, value)) {
          return;
        }

        window = await window;
        if (!deepCopyCompare(value, defaultValue)) {
          await browser.sessions.setWindowValue(window.id, dataKey, value);
        } else {
          await browser.sessions.removeWindowValue(window.id, dataKey);
        }

        await browser.runtime.sendMessage({ type: messageTypes.windowDataChange, windowId: window.id, key: dataKey, newValue: value });

        currentValue = value;
      },
      200,
      false,
    );

    this.updater = valueUpdater;

    var lastValue = currentValue;
    defineProperty(this, 'value', async () => deepCopy(await currentValue), (value) => {
      valueChanged = true;
      value = deepCopy(value);
      lastValue = value;
      valueUpdater.invalidate(value);
    });
    defineProperty(this, 'lastValue', async () => deepCopy(await lastValue));
  }
}

async function initiatePage() {
  let currentWindow = browser.windows.getCurrent();
  let sectionAnimation = new AnimationInfo({});


  // #region Handle Permissions

  let isAllowedPromise = browser.permissions.contains({ permissions: ['sessions'] });
  const warnAboutPermissions = async () => {
    const [majorVersion,] = (await browserInfo).version.split('.');
    if (majorVersion >= 77) {
      const isAllowed = await isAllowedPromise;
      if (isAllowed) return;
      browser.permissions.request({ permissions: ['sessions'] }).then(granted => {
        // This code is likely to not be reached since the popup will be closed when the user clicks on the permission prompt.
        if (granted) {
          browser.runtime.sendMessage({ type: messageTypes.permissionsChanged, permission: 'sessions', value: true });
        }
        // Prevent this code from running many times:
        isAllowedPromise = true;
      });
    }
    alert(browser.i18n.getMessage('popup_PermissionWarning'));
  };

  // #endregion Handle Permissions


  // #region Window Name

  let nameArea = document.createElement('div');
  nameArea.classList.add('windowNameArea');
  nameArea.classList.add('area');
  nameArea.classList.add('noMargin');
  document.body.appendChild(nameArea);

  let nameHeaderArea = document.createElement('div');
  nameHeaderArea.classList.add('nameHeaderArea');
  nameArea.appendChild(nameHeaderArea);

  let nameLabel = document.createElement('label');
  nameLabel.classList.add('windowNameLabel');
  nameLabel.classList.add(messagePrefix + 'popup_WindowName');
  nameHeaderArea.appendChild(nameLabel);

  let optionsShortcut = document.createElement('div');
  optionsShortcut.classList.add('optionsShortcut');
  optionsShortcut.setAttribute('tabindex', String(0));
  optionsShortcut.setAttribute('role', 'button');
  optionsShortcut.setAttribute('title', browser.i18n.getMessage('popup_SettingsShortcutTooltip'));
  nameHeaderArea.appendChild(optionsShortcut);

  const openSettings = async () => {
    await browser.runtime.openOptionsPage();
    await delay(75);
    window.close();
  };
  optionsShortcut.addEventListener('click', (e) => openSettings());
  optionsShortcut.addEventListener('keydown', (e) => {
    // 13 = Return, 32 = Space
    if (![13, 32].includes(e.keyCode))
      return;

    openSettings();
  });

  var windowName = document.createElement('input');
  windowName.id = 'windowName';
  windowName.type = 'text';
  nameArea.appendChild(windowName);

  // Set focus to the name input field when popup is opened:
  // Requires Firefox 60 or later due to bug: https://bugzilla.mozilla.org/show_bug.cgi?id=1324255
  windowName.focus();


  let nameDataManager = new WindowSessionDataManager(
    currentWindow,
    windowDataKeys.name,
    (value) => {
      windowName.value = value;
    },
    (value) => {
      if (!value) {
        return '';
      }
      return value;
    }
  );


  new EventListener(windowName, 'input', (e) => {
    nameDataManager.value = windowName.value;
    warnAboutPermissions();
  });
  new EventListener(windowName, 'keypress', (e) => {
    if (e.key === "Enter") {
      nameDataManager.updater.unblock();
      window.close();
    }
  });

  // #endregion Window Name


  // #region Name Placeholders

  {
    let formatPlaceholderSection = createCollapsableArea(sectionAnimation);
    formatPlaceholderSection.content.classList.add('textSelectable');
    formatPlaceholderSection.area.classList.add('noShadow');
    formatPlaceholderSection.area.classList.add('formatSection');
    formatPlaceholderSection.title.classList.add('small');
    formatPlaceholderSection.title.classList.add('center');
    document.body.appendChild(formatPlaceholderSection.area);

    let header = document.createElement('div');
    header.classList.add(messagePrefix + 'popup_FormatPlaceholders');
    formatPlaceholderSection.title.appendChild(header);

    let formatInfoWrapper = document.createElement('div');
    formatInfoWrapper.classList.add('formatInfoWrapper');
    formatPlaceholderSection.content.appendChild(formatInfoWrapper);

    let formatPlaceholderArea = document.createElement('div');
    formatPlaceholderArea.classList.add('formatInfo');
    formatInfoWrapper.appendChild(formatPlaceholderArea);


    let platformSection = createCollapsableArea(sectionAnimation);
    platformSection.content.classList.add('textSelectable');
    platformSection.area.classList.add('noShadow');
    platformSection.area.classList.add('formatSection');
    platformSection.title.classList.add('small');
    platformSection.title.classList.add('center');
    formatInfoWrapper.appendChild(platformSection.area);

    let platformHeader = document.createElement('div');
    platformHeader.classList.add(messagePrefix + 'popup_FormatPlaceholders_PlatformInfo');
    platformSection.title.appendChild(platformHeader);


    let notNameFormatPlaceholdersArea = document.createElement('div');
    notNameFormatPlaceholdersArea.classList.add('formatInfo');
    notNameFormatPlaceholdersArea.classList.add('notNamePlaceholders');
    formatInfoWrapper.appendChild(notNameFormatPlaceholdersArea);

    let notNameHeader = document.createElement('label');
    notNameHeader.classList.add(messagePrefix + 'popup_NotNameFormatPlaceholders');
    notNameHeader.classList.add('notNamePlaceholdersHeader');
    notNameHeader.classList.add('textNotSelectable');
    notNameFormatPlaceholdersArea.appendChild(notNameHeader);
    notNameFormatPlaceholdersArea.appendChild(document.createElement('br'));


    let placeholderSections = [
      {
        area: platformSection.content,
        /** @type {FormatPlaceholder[]} */
        placeholders: [
          formatPlaceholders.platformOS,
          formatPlaceholders.platformArchitecture,
          formatPlaceholders.firefoxVersion,
          formatPlaceholders.firefoxBuildId,
        ],
      },
      {
        area: notNameFormatPlaceholdersArea,
        placeholders: [
          formatPlaceholders.ifWindowName,
          formatPlaceholders.windowName,
        ],
      },
    ];

    for (let placeholder of FormatPlaceholder.all) {
      let area = document.createElement('div');
      area.classList.add('formatPlaceholder');
      area.innerHTML = placeholder.messageText;

      let placed = false;
      for (const placeholderSection of placeholderSections) {
        if (!placeholderSection.placeholders.includes(placeholder)) {
          continue;
        }
        placeholderSection.area.appendChild(area);
        placed = true;
        break;
      }
      if (!placed) {
        formatPlaceholderArea.appendChild(area);
      }
    }
  }

  // #endregion Name Placeholders


  // #region Setting overrides

  {
    let onLoadedSettings = new EventManager();
    let settingDataManager = new WindowSessionDataManager(
      currentWindow,
      windowDataKeys.settings,
      (value) => {
        onLoadedSettings.fire(value);
      },
      (value) => {
        if (!value) {
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
      }
    );

    let settingArea = createCollapsableArea(sectionAnimation);
    settingArea.title.classList.add('small');
    settingArea.area.classList.add('noShadow');
    settingArea.area.classList.add('settingArea');
    settingArea.title.classList.add('center');
    document.body.appendChild(settingArea.area);

    settingArea.title.classList.add('enablable');
    settingArea.content.classList.add('standardFormat');

    let settingTitle = document.createElement('div');
    settingTitle.classList.add('settingTitle');
    settingTitle.classList.add(messagePrefix + 'popup_SettingsTitle');
    settingArea.title.appendChild(settingTitle);

    let settingOverrides = [];
    let checkIfAnyOverrideSetting = () => {
      toggleClass(settingArea.title, 'enabled', settingOverrides.filter(obj => obj.override).length > 0);
    };

    let createOverrideSetting = (settingKey) => {
      let currentValue;
      let onChange = new EventManager();
      var change = async () => {
        let latest = await settingDataManager.lastValue;
        let settingKeyData = latest[settingKey];
        settingKeyData.override = overrideObj.checkbox.checked;
        settingKeyData.value = currentValue;
        settingDataManager.value = latest;
      };

      let area = document.createElement('div');
      area.classList.add('area');
      area.classList.add('overideSettingArea');
      area.classList.add('noMargin');
      area.classList.add('noPadding');

      let overrideObj = createCheckBox(null, 'popup_SettingsOverride');
      overrideObj.area.classList.add('overrideArea');
      area.appendChild(overrideObj.area);

      overrideObj.checkbox.addEventListener('input', (e) => {
        warnAboutPermissions();
        change();
        checkIfAnyOverrideSetting();
      });

      let contentArea = document.createElement('div');
      contentArea.classList.add('overrideSettingArea');
      area.appendChild(contentArea);

      let setValue = (value, internal = false) => {
        if (value === currentValue) {
          return;
        }
        currentValue = value;

        if (internal) {
          onChange.fire(value);
        } else {
          change();
        }
      };

      onLoadedSettings.addListener((settingsData) => {
        if (settingsData && settingsData[settingKey]) {
          let dataManager = settingsData[settingKey];
          overrideObj.checkbox.checked = dataManager.override;
          setValue(dataManager.value, true);

          checkIfAnyOverrideSetting();
        }
      });


      var obj = {
        area: area,
        content: contentArea,

        onChange: onChange.subscriber,
      };
      defineProperty(obj, 'value', () => deepCopy(currentValue), (value) => setValue(value));
      defineProperty(obj, 'override', () => overrideObj.checkbox.checked);


      settingArea.content.appendChild(area);
      settingOverrides.push(obj);
      return obj;
    };

    {
      let defaultName = createOverrideSetting('windowPrefixFormat');

      let info = document.createElement('div');
      info.classList.add(messagePrefix + 'options_Format');
      defaultName.content.appendChild(info);

      let defaultNameInput = document.createElement('input');
      defaultNameInput.type = 'text';
      defaultName.content.appendChild(defaultNameInput);

      defaultNameInput.addEventListener('input', (e) => {
        defaultName.value = defaultNameInput.value;
        warnAboutPermissions();
      });
      defaultName.onChange.addListener((value) => {
        defaultNameInput.value = value;
      });
    }

  }

  // #endregion Setting overrides


  // #region Session Restore Tracking

  if (debug.popup_sessionRestoreTracking) {
    let restoreTracked = createCheckBox();
    restoreTracked.label.textContent = 'Tracked';

    let trackedData = new WindowSessionDataManager(currentWindow, windowDataKeys.isRestored, (value) => { restoreTracked.checkbox.checked = value; }, (value) => Boolean(value));

    restoreTracked.checkbox.addEventListener('input', (e) => { trackedData.value = restoreTracked.checkbox.checked; });

    document.body.appendChild(restoreTracked.area);
  }

  // #endregion Session Restore Tracking


  setTextMessages(null, { asHTML: true, });
  await settingsTracker.start;
  let checkAnimations = () => {
    if (settings.disablePopupPageAnimations) {
      sectionAnimation.update({ reset: true });
    } else {
      sectionAnimation.update({ standard: true, collapseBodyImmediately: false });
    }
  };
  settingsTracker.onChange.addListener((changes) => {
    if (changes.disablePopupPageAnimations) {
      checkAnimations();
    }
    if (changes.popupPage_width) {
      document.body.style.width = settings.popupPage_width >= 0 ? settings.popupPage_width + 'px' : '';
    }
    if (changes.popupPage_disableDarkTheme) {
      toggleClass(document.documentElement, 'support-dark-theme', !settings.popupPage_disableDarkTheme);
    }
  });
  checkAnimations();
}


initiatePage();
