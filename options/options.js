
async function initiatePage() {
    let settingsTracker = new SettingsTracker();
    let settings = settingsTracker.settings;

    var pagePort = new PortConnection();
    var sectionAnimation = { standard: false }; // No animation before load to expand initial sections immediately.

    // #region Delayed Listener Startup

    var eventStarters = new DisposableCreators();
    var startListener = (callback) => eventStarters.createDisposable(callback);
    var startAllListeners = () => {
        eventStarters.stop();
        eventStarters.start();
    };
    startListener(() => bindElementIdsToSettings(settings));

    // #endregion Delayed Listener Startup


    // #region Window Title

    {
        let winTitleSection = createCollapsableArea(sectionAnimation);
        winTitleSection.isCollapsed = false;
        winTitleSection.area.classList.add('standardFormat');
        winTitleSection.title.classList.add('center');
        document.body.appendChild(winTitleSection.area);

        let header = document.createElement('div');
        header.classList.add(messagePrefix + 'options_GeneralSection_Header');
        winTitleSection.title.appendChild(header);

        winTitleSection.content.appendChild(document.getElementById('generalSettingsArea'));
    }

    // #endregion Window Title

    // #region Format Placeholders

    {
        let formatPlaceholderArea = document.getElementById('formatPlaceholders');
        for (let placeholder of FormatPlaceholder.all) {
            let area = document.createElement('div');
            area.innerHTML = placeholder.messageText;
            formatPlaceholderArea.appendChild(area);
        }
    }

    // #endregion Format Placeholders


    // #region Stop & Start Button

    {
        let _isUpdating = false;
        let manager = {
            get isUpdating() {
                return Boolean(_isUpdating);
            },
            set isUpdating(value) {
                value = Boolean(value);
                let oldValue = _isUpdating;
                _isUpdating = value;

                if (value) {
                    document.documentElement.classList.add("updating");
                    if (oldValue) {
                        browser.runtime.sendMessage({ type: messageTypes.updatePrefix });
                    }
                } else {
                    document.documentElement.classList.remove("updating");
                    browser.runtime.sendMessage({ type: messageTypes.clearPrefix });
                }

                Settings.set("isEnabled", value);
            },
        };

        startListener(() => {
            if (settings.isEnabled) {
                manager.isUpdating = true;
            }
        });


        document.getElementById("stopUpdates").addEventListener("click", e => {
            manager.isUpdating = false;
        });
        document.getElementById("startUpdates").addEventListener("click", e => {
            manager.isUpdating = true;
        });
    }

    // #endregion Stop & Start Button


    // #region Window Data

    {
        let winDataSection = createCollapsableArea(sectionAnimation);
        winDataSection.isCollapsed = false;
        winDataSection.area.classList.add('standardFormat');
        winDataSection.title.classList.add('center');
        document.body.appendChild(winDataSection.area);

        let header = document.createElement('div');
        header.classList.add(messagePrefix + 'options_WindowData_Header');
        winDataSection.title.appendChild(header);

        winDataSection.content.appendChild(document.getElementById('windowDataArea'));

        document.getElementById('clearWindowDataButton').addEventListener('click', () => {
            let ok = confirm(browser.i18n.getMessage('options_WindowData_ClearData_Warning'));
            if (ok) {
                browser.runtime.sendMessage({ type: messageTypes.clearWindowData });
            }
        });
        document.getElementById('applyDefaultWindowNameButton').addEventListener('click', () => {
            let ok = confirm(browser.i18n.getMessage('options_WindowData_ApplyDefaultName_Warning'));
            if (ok) {
                browser.runtime.sendMessage({ type: messageTypes.applyWindowName, name: document.getElementById('windowDefaultName').value });
            }
        });
    }

    // #endregion Window Data



    // #region Commands

    {
        const { area, update } = createCommandArea({
            sectionAnimationInfo: sectionAnimation,
            commandInfos: {
                '_execute_browser_action': {
                    description: 'options_Commands_BrowserAction',
                    createContent: () => {
                        return null;
                    },
                },
            }
        });
        eventStarters.createDisposable(() => {
            update();
        });
    }

    // #endregion Commands



    // #region Fix No Title for New Tab Pages

    {
        let fixNoTitleSection = createCollapsableArea(sectionAnimation);
        fixNoTitleSection.title.classList.add('enablable');
        fixNoTitleSection.title.classList.add('center');
        fixNoTitleSection.area.classList.add('standardFormat');
        document.body.appendChild(fixNoTitleSection.area);

        let fixNoTitleHeader = document.createElement('div');
        fixNoTitleHeader.classList.add(messagePrefix + 'options_NewTabNoTitleWorkaround_Header');
        fixNoTitleSection.title.appendChild(fixNoTitleHeader);

        let fixNoTitleArea = document.getElementById('fixNoTabForNewTabPagesArea');
        fixNoTitleSection.content.appendChild(fixNoTitleArea);

        let fixNoTitleCheckbox = document.getElementById('newTabNoTitleWorkaround_Enabled');
        let checkboxChanged = () => {
            let value = fixNoTitleCheckbox.checked;
            toggleClass(fixNoTitleSection.title, 'enabled', value);
            toggleClass(fixNoTitleArea, 'enabled', value);
        };
        let checkPermission = async () => {
            let hasPermissions = await browser.permissions.contains({ permissions: ['tabs'] });
            toggleClass(fixNoTitleSection.title, 'error', !hasPermissions);
        };
        startListener(() => {
            let listener = new EventListener(fixNoTitleCheckbox, 'input', (e) => checkboxChanged());
            checkboxChanged();
            let permissionListener = new EventListener(onPermissionChange, () => checkPermission());
            checkPermission();
            return [listener, permissionListener];
        });
    }

    // #endregion Fix No Title for New Tab Pages


    // #region Optional Permissions
    var onPermissionChange;
    {
        let optionalPermissionsArea = createCollapsableArea(sectionAnimation);
        optionalPermissionsArea.area.classList.add('standardFormat');
        optionalPermissionsArea.title.classList.add('center');
        optionalPermissionsArea.title.classList.add('enablable');
        optionalPermissionsArea.content.classList.add('optionalPermissionArea');
        document.body.appendChild(optionalPermissionsArea.area);

        let permissionControllers = [];
        onPermissionChange = new EventManager();
        onPermissionChange.addListener(() => {
            let hasAnyPermission = permissionControllers.filter(controller => controller.hasPermission).length > 0;
            toggleClass(optionalPermissionsArea.title, 'enabled', hasAnyPermission);
        });
        let pagePermissionChanged = pagePort.getEvent('permissionChanged');


        let areaDetails = {
            requestViaBrowserActionCallback: async (permission) => await pagePort.sendMessageBoundToPort({ type: messageTypes.requestPermission, permission: permission }),
            permissionChangedCallback: (obj, internalChange) => {
                if (internalChange) {
                    browser.runtime.sendMessage({ type: messageTypes.permissionsChanged, permission: obj.permission, value: obj.hasPermission });
                }
                onPermissionChange.fire(obj);
            },
            onPermissionChanged: pagePermissionChanged,
            sectionAnimationInfo: sectionAnimation,
        };

        let createPermissionButtonArea = function (permission, titleMessage, explanationMessage) {
            let obj = createOptionalPermissionArea(Object.assign(areaDetails, { permission, titleMessage, explanationMessage }));
            permissionControllers.push(obj);
            optionalPermissionsArea.content.appendChild(obj.area);
            return obj;
        };

        let header = document.createElement('div');
        header.classList.add(messagePrefix + 'options_OptionalPermissions_Header');
        optionalPermissionsArea.title.appendChild(header);

        createPermissionButtonArea({ permissions: ['tabs'] }, 'options_OptionalPermissions_Tabs_Title', 'options_OptionalPermissions_Tabs_Explanation');
    }

    // #endregion Optional Permissions


    document.body.appendChild(document.getElementById('otherSettings'));

    document.getElementById('resetSettingsButton').addEventListener('click', async (e) => {
        let ok = confirm(browser.i18n.getMessage('options_resetSettings_Prompt'));
        if (!ok) {
            return;
        }

        // Reset commands:
        await Promise.all((await browser.commands.getAll()).map(command => browser.commands.reset(command.name)));

        // Clear settings:
        await browser.storage.local.clear();

        // Reload options info:
        startAllListeners();
    });


    setTextMessages();
    await settingsTracker.start;
    startAllListeners();

    let checkAnimations = () => {
        if (settings.disableOptionsPageAnimations) {
            sectionAnimation.update({ reset: true });
        } else {
            sectionAnimation.update({ standard: true });
        }
    };
    settingsTracker.onChange.addListener((changes) => {
        if (changes.disableOptionsPageAnimations) {
            checkAnimations();
        }
    });
    checkAnimations();
}


initiatePage();

