
let onPermissionChange = new EventManager();

async function initiatePage() {
    let settings = Settings.get(new Settings());


    let screenBlocker = document.createElement('div');
    screenBlocker.classList.add('screenBlocker');
    document.body.appendChild(screenBlocker);

    let openPort = async () => {
        let currentTab = await browser.tabs.getCurrent();
        return browser.runtime.connect({ name: 'optionsPage_tab' + currentTab.id });
    };
    var pagePort = openPort();


    // #region Delayed Listener Startup

    var listenerStarters = [];
    var listenerCollection = null;
    var startListener = function (listenerCallback) {
        listenerStarters.push(listenerCallback);
        if (listenerCollection) {
            listenerCollection.trackDisposables(listenerCallback());
        }
    };
    var startAllListeners = () => {
        if (!listenerCollection) {
            listenerCollection = new DisposableCollection(listenerStarters.map(callback => callback()));
        }
    };
    var stopAllListeners = () => {
        if (listenerCollection) {
            listenerCollection.dispose();
            listenerCollection = null;
        }
    };

    // #endregion Delayed Listener Startup


    // #region Window Title

    {
        let winTitleSection = createCollapsableArea();
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
        let isFirst = true;
        for (let placeholder of FormatPlaceholder.all) {
            if (!isFirst) {
                formatPlaceholderArea.appendChild(document.createElement('br'));
            }
            let area = document.createElement('label');
            area.textContent = placeholder.messageText;
            formatPlaceholderArea.appendChild(area);
            isFirst = false;
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
        let winDataSection = createCollapsableArea();
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


    // #region Fix No Title for New Tab Pages

    {
        let fixNoTitleSection = createCollapsableArea();
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
            toggleClass(fixNoTitleSection.title, 'permissionNeeded', !hasPermissions);
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

    {
        let optionalPermissionsArea = createCollapsableArea();
        optionalPermissionsArea.area.classList.add('standardFormat');
        optionalPermissionsArea.title.classList.add('center');
        optionalPermissionsArea.title.classList.add('enablable');
        optionalPermissionsArea.content.classList.add('optionalPermissionArea');
        document.body.appendChild(optionalPermissionsArea.area);

        let browserActionPrompt = document.createElement('div');
        browserActionPrompt.classList.add('browserActionPrompt');
        browserActionPrompt.classList.add('prompt');
        document.documentElement.appendChild(browserActionPrompt);

        let browserActionPromptInfo = document.createElement('div');
        browserActionPromptInfo.classList.add(messagePrefix + 'options_OptionalPermissions_BrowserActionPrompt');
        browserActionPrompt.appendChild(browserActionPromptInfo);

        let permissionControllers = [];
        onPermissionChange.addListener(() => {
            let hasAnyPermission = permissionControllers.filter(controller => controller.hasPermission).length > 0;
            toggleClass(optionalPermissionsArea.title, 'enabled', hasAnyPermission);
        });
        let createPermissionButtonArea = function (permission, titleMessage, explanationMessage) {
            let obj = {};
            let hasPermission = false;

            let section = createCollapsableArea();
            section.area.classList.add('standardFormat');
            section.area.classList.add('permissionController');
            section.title.classList.add('noFontChanges');
            section.title.classList.add('enablable');

            let permissionChanged = () => {
                toggleClass(section.area, 'granted', hasPermission);
                toggleClass(section.title, 'enabled', hasPermission);

                onPermissionChange.fire(obj);
            };


            let manageArea = document.createElement('div');
            manageArea.classList.add('manageArea');
            manageArea.classList.add('preventOpen');
            section.title.appendChild(manageArea);

            let requestButton = document.createElement('button');
            requestButton.classList.add(messagePrefix + 'options_OptionalPermissions_Request');
            manageArea.appendChild(requestButton);

            let removeButton = document.createElement('button');
            removeButton.classList.add(messagePrefix + 'options_OptionalPermissions_Remove');
            manageArea.appendChild(removeButton);


            let permissionHeader = document.createElement('div');
            permissionHeader.classList.add('permissionHeader');
            permissionHeader.classList.add(messagePrefix + titleMessage);
            section.title.appendChild(permissionHeader);


            let permissionInfobox = document.createElement('div');
            permissionInfobox.classList.add('permissionInfobox');
            section.title.appendChild(permissionInfobox);

            let infoText = document.createElement('div');
            infoText.classList.add(messagePrefix + 'options_OptionalPermissions_Available');
            permissionInfobox.appendChild(infoText);

            let grantedInfo = document.createElement('div');
            grantedInfo.classList.add('granted');
            grantedInfo.classList.add(messagePrefix + 'options_OptionalPermissions_Granted');
            permissionInfobox.appendChild(grantedInfo);

            let removedInfo = document.createElement('div');
            removedInfo.classList.add('notGranted');
            removedInfo.classList.add(messagePrefix + 'options_OptionalPermissions_NotGranted');
            permissionInfobox.appendChild(removedInfo);


            let explanation = document.createElement('div');
            explanation.classList.add(messagePrefix + explanationMessage);
            explanation.classList.add('textSelectable');
            section.content.appendChild(explanation);


            let start = async () => {
                hasPermission = await browser.permissions.contains(permission);
                permissionChanged();

                let handleButtonClick = async (e) => {
                    let wantedState = e.target === requestButton;
                    try {
                        try {
                            if (wantedState) {
                                let granted = await browser.permissions.request(permission);
                            } else {
                                let removed = await browser.permissions.remove(permission);
                            }
                        } catch (error) {
                            // Failed to request permission from this page! Try via browser action:
                            let listenerCollection = new DisposableCollection();
                            try {
                                document.documentElement.classList.add('blockScreen');
                                document.documentElement.classList.add('prompting');
                                browserActionPrompt.style.top = e.clientY + 'px';
                                browserActionPrompt.classList.add('active');
                                listenerCollection.trackDisposables([
                                    new EventListener(document, 'click', async (e) => {
                                        await browser.runtime.sendMessage({ type: messageTypes.requestPermission, permission: null });
                                    }),
                                ]);
                                pagePort = await pagePort;
                                await browser.runtime.sendMessage({ type: messageTypes.requestPermission, permission: permission, portName: pagePort.name });
                            } finally {
                                document.documentElement.classList.remove('blockScreen');
                                document.documentElement.classList.remove('prompting');
                                browserActionPrompt.classList.remove('active');
                                listenerCollection.dispose();
                            }
                        }
                    } catch (error) {
                        console.log('Failed to modify optional permission!\n', error);
                    }

                    let newHasPermission = await browser.permissions.contains(permission);
                    if (newHasPermission === hasPermission) {
                        return;
                    }

                    hasPermission = newHasPermission;
                    browser.runtime.sendMessage({ type: messageTypes.permissionsChanged, permission: permission, value: hasPermission });
                    permissionChanged();
                };

                requestButton.addEventListener('click', handleButtonClick);
                removeButton.addEventListener('click', handleButtonClick);
            };


            Object.assign(obj, {
                area: section.area,

                permission: permission,
            });
            defineProperty(obj, 'hasPermission', () => hasPermission);

            permissionControllers.push(obj);
            optionalPermissionsArea.content.appendChild(section.area);

            obj.start = start();
            return obj;
        };

        let header = document.createElement('div');
        header.classList.add(messagePrefix + 'options_OptionalPermissions_Header');
        optionalPermissionsArea.title.appendChild(header);

        createPermissionButtonArea({ permissions: ['tabs'] }, 'options_OptionalPermissions_Tabs_Title', 'options_OptionalPermissions_Tabs_Explanation');

    }

    // #endregion Optional Permissions

    setTextMessages();
    settings = await settings;
    bindElementIdsToSettings(settings);
    startAllListeners();
}


initiatePage();

